# Gera os pacotes de atualizacao + o manifest.json e (opcionalmente) publica o
# Release no repositorio privado de distribuicao.
#
#   powershell -File tools\publish-release.ps1              # DRY-RUN: so' gera em dist\release\
#   powershell -File tools\publish-release.ps1 -Publish     # gera E sobe o Release via gh
#
# DRY-RUN E' O PADRAO de proposito: publicar um manifesto errado quebra a
# instalacao de quem ja' tem o jogo, e nao da' para "despublicar" um download que
# ja' aconteceu. Confira o dist\release\manifest.json antes de passar -Publish.
#
# Requisitos AQUI: PowerShell. Para -Publish, o `gh` CLI autenticado.

[CmdletBinding()]
param(
  [switch]$Publish,
  # Vazio = carimbo de data/hora. O cliente busca /releases/latest, entao o nome
  # da tag nao precisa ser bonito - precisa ser unico.
  [string]$Tag = "",
  # EXIGE o exe: falha se dist\ClassicDuels.exe nao existir. Desde 22/08/2026 o
  # exe ja' vai em TODA publicacao que tenha um empacotado (ver a secao `o exe no
  # manifesto`, la' embaixo), entao esta flag deixou de ser o que liga o
  # auto-update do executavel — e' so' a recusa de publicar sem ele.
  [switch]$ComExe,
  # Apaga os Releases antigos, mantendo os N mais recentes. 0 = nao apaga nada
  # (o padrao). Fica FORA do caminho normal de proposito: apagar Release e'
  # irreversivel e o cliente so' busca /releases/latest, entao acumular custa
  # apenas legibilidade da lista. Rode quando ela incomodar.
  [int]$PodarReleases = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root    = Split-Path -Parent $PSScriptRoot
$saida   = Join-Path $root 'dist\release'
$stage   = Join-Path $env:TEMP 'classic-duels-release'

$owner = 'FelisbertoJPG'
$repo  = 'yugi-server-'

function Passo($n, $t) { Write-Host "`n[$n] $t" -ForegroundColor Cyan }
function Ok($t)        { Write-Host "  OK   $t" -ForegroundColor Green }
function Aviso($t)     { Write-Host "  !    $t" -ForegroundColor Yellow }
function Falhar($t)    { Write-Host "  ERRO $t" -ForegroundColor Red; exit 1 }

# Impressao digital dos fontes da CASCA (duel-server\host). A MESMA conta do
# `DigitalDaCasca` do tools\pack.ps1 e do publicar\Program.cs — por CONTEUDO, e
# nunca por data de modificacao: copiar a pasta do projeto entre maquinas
# reescreve a data de todo arquivo e acusaria mudanca em fonte que ninguem tocou.
function DigitalDaCasca($raiz) {
  $host_ = Join-Path $raiz 'duel-server\host'
  if (-not (Test-Path $host_)) { return '' }

  $sha = [System.Security.Cryptography.SHA256]::Create()
  $linhas = [System.Collections.Generic.List[string]]::new()
  foreach ($f in Get-ChildItem $host_ -Recurse -File -Filter *.cs) {
    $rel = $f.FullName.Substring($host_.Length).TrimStart('\', '/').Replace('\', '/')
    $h = [System.BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes($f.FullName)))
    $linhas.Add("$rel|$($h.Replace('-', '').ToLowerInvariant())")
  }
  $linhas.Sort([StringComparer]::Ordinal)

  $tudo = [System.Text.Encoding]::UTF8.GetBytes(($linhas -join "`n"))
  return [System.BitConverter]::ToString($sha.ComputeHash($tudo)).Replace('-', '').ToLowerInvariant()
}

# ---------------------------------------------------------------- tabuleiros
# Um campo criado NO JOGO grava em %LOCALAPPDATA%\ClassicDuels\game\boards\, nao
# no repositorio - so' o banco ve os dois mundos. Sem isto, um tabuleiro feito
# no .exe chegava nos outros jogadores (o front le `tabuleiros`) mas nunca
# entrava no game.zip nem no git: instalacao nova e offline ficavam sem ele.
#
# A leitura de `tabuleiros` e' aberta (policy `tabuleiros_ler_todos`), entao
# basta a chave publicavel - a mesma que ja' vai dentro do jogo. Ler dela em
# `web/js/supabase.js` evita uma segunda copia da URL/chave para envelhecer.
function ConfigSupabase {
  $arq = Join-Path $root 'web\js\supabase.js'
  if (-not (Test-Path $arq)) { return $null }
  $txt = Get-Content $arq -Raw
  $u = [regex]::Match($txt, "SUPABASE_URL\s*=\s*'([^']+)'")
  $k = [regex]::Match($txt, "SUPABASE_KEY\s*=\s*'([^']+)'")
  if (-not ($u.Success -and $k.Success)) { return $null }
  return @{ url = $u.Groups[1].Value; key = $k.Groups[1].Value }
}

# Comparacao por CONTEUDO, nao por texto: o arquivo no disco foi escrito pelo
# navegador (JSON.stringify(...,2)) e este script serializa diferente. Sem
# normalizar, todo build reescreveria os dois tabuleiros e sujaria o git a' toa.
#
# Ainda assim a PRIMEIRA sincronia reescreve tudo, e nao e' bug: `dados` e'
# `jsonb`, que NAO preserva a ordem das chaves. O que volta do banco tem a
# ordem normalizada do Postgres, diferente da que o navegador gravou - entao
# os objetos "diferem" uma vez, o disco assume a ordem do banco, e dai' em
# diante as comparacoes batem e nenhum build mexe nos arquivos.
function MesmoJson($a, $b) {
  try { return (($a | ConvertTo-Json -Depth 30 -Compress) -eq ($b | ConvertTo-Json -Depth 30 -Compress)) }
  catch { return $false }
}

# Traz `tabuleiros` do banco para `boards/`. NUNCA apaga: tabuleiro que so'
# existe no disco (feito offline, ainda nao publicado) fica onde esta'.
# Falha de rede nao derruba o release - o pacote sai com o que ja' ha' no disco.
function SincronizarTabuleiros {
  $cfg = ConfigSupabase
  if (-not $cfg) { Aviso 'nao li a config do Supabase (pulando a sincronia)'; return }

  $destino = Join-Path $root 'boards'
  if (-not (Test-Path $destino)) { New-Item -ItemType Directory -Path $destino -Force | Out-Null }

  try {
    $linhas = Invoke-RestMethod -Method Get -TimeoutSec 20 `
      -Uri "$($cfg.url)/rest/v1/tabuleiros?select=nome,dados" `
      -Headers @{ apikey = $cfg.key }
  } catch {
    Aviso "banco inacessivel ($($_.Exception.Message.Split([Environment]::NewLine)[0])) - usando so' o disco"
    return
  }

  $novos = 0; $atualizados = 0
  foreach ($linha in @($linhas)) {
    if (-not $linha.nome -or -not $linha.dados) { continue }
    $nome = Split-Path -Leaf $linha.nome           # nunca sair de boards/
    if ($nome -notmatch '\.json$') { $nome = "$nome.json" }
    $alvo = Join-Path $destino $nome

    if (Test-Path $alvo) {
      $atual = try { Get-Content $alvo -Raw | ConvertFrom-Json } catch { $null }
      if ($atual -and (MesmoJson $atual $linha.dados)) { continue }
      $atualizados++
    } else { $novos++ }

    $txt = $linha.dados | ConvertTo-Json -Depth 30
    [System.IO.File]::WriteAllText($alvo, $txt, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "       <- $nome" -ForegroundColor DarkGray
  }
  if ($novos -or $atualizados) { Ok "banco: $novos novo(s), $atualizados atualizado(s)" }
  else { Ok 'banco: nada novo (disco ja esta em dia)' }
}

# Mesma historia dos tabuleiros: um deck de adversario montado DENTRO do jogo
# grava em %LOCALAPPDATA%\ClassicDuels\game\decks\npc\, nao no repositorio. Sem
# descer o banco antes de empacotar, o deck do Pegasus (por exemplo) chegava aos
# jogadores pelo `decks_npc` mas nunca entrava no git nem numa instalacao nova.
#
# NUNCA apaga: deck que so' existe no disco (feito offline, ainda nao publicado)
# fica onde esta'. Falha de rede tambem nao derruba o release.
function SincronizarDecksNpc {
  $cfg = ConfigSupabase
  if (-not $cfg) { Aviso 'nao li a config do Supabase (pulando os decks de NPC)'; return }

  try {
    $linhas = Invoke-RestMethod -Method Get -TimeoutSec 20 `
      -Uri "$($cfg.url)/rest/v1/decks_npc?select=npc,nome,ydk" `
      -Headers @{ apikey = $cfg.key }
  } catch {
    Aviso "banco inacessivel ($($_.Exception.Message.Split([Environment]::NewLine)[0])) - usando so' o disco"
    return
  }

  $novos = 0; $atualizados = 0
  foreach ($linha in @($linhas)) {
    if (-not $linha.npc -or -not $linha.nome -or -not $linha.ydk) { continue }
    # `Split-Path -Leaf` nos dois: a chave vem do banco e nao pode virar `..\`.
    $pasta = Join-Path (Join-Path $root 'decks\npc') (Split-Path -Leaf $linha.npc)
    if (-not (Test-Path $pasta)) { New-Item -ItemType Directory -Path $pasta -Force | Out-Null }
    $alvo = Join-Path $pasta ((Split-Path -Leaf $linha.nome) + '.ydk')

    # Compara SEM as quebras de linha E sem o branco do fim: o .ydk viaja com
    # \n no banco, o disco pode ter \r\n, e o arquivo pode ou nao terminar em
    # nova linha. Sem normalizar os tres, todo build reescreveria os mesmos
    # arquivos e o git nunca ficaria limpo (medido: "2 atualizados" a cada run).
    $novo = ($linha.ydk -replace "`r`n", "`n").TrimEnd()
    if (Test-Path $alvo) {
      # `-Encoding utf8` nao e' zelo: sem ele o PS 5.1 le' em ANSI, o "É" de
      # "É o Mundo Toon!!!" vira outro byte, a comparacao NUNCA casa e o build
      # reescreve os mesmos arquivos para sempre (medido: "2 atualizados" a
      # cada run, com o conteudo identico conferido por fora).
      $atual = ((Get-Content $alvo -Raw -Encoding utf8) -replace "`r`n", "`n").TrimEnd()
      if ($atual -eq $novo) { continue }
      $atualizados++
    } else { $novos++ }

    [System.IO.File]::WriteAllText($alvo, $novo + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "       <- $($linha.npc)/$($linha.nome).ydk" -ForegroundColor DarkGray
  }
  if ($novos -or $atualizados) { Ok "decks de NPC: $novos novo(s), $atualizados atualizado(s)" }
  else { Ok 'decks de NPC: nada novo (disco ja esta em dia)' }
}

function Sha256($caminho) {
  (Get-FileHash -Algorithm SHA256 -Path $caminho).Hash.ToLowerInvariant()
}

# Impressao digital do CONTEUDO de um pacote: uma linha "entrada|sha256" por
# arquivo dentro do zip, ordenadas por ordinal, e o sha256 disso tudo.
#
# POR QUE NAO O SHA DO PROPRIO .ZIP, que e' o que o marcador usava ate'
# 19/08/2026: dois zips com exatamente os mesmos arquivos dentro nao tem os
# mesmos bytes fora. A saida do deflate muda com a versao do runtime que
# comprimiu, entao empacotar noutra maquina gerava marcador novo para conteudo
# identico — e o cliente compara MARCADOR, nao conteudo. O sintoma foi medido:
# game.zip (92 entradas) e cards.zip (20.951 entradas) publicados e regerados
# aqui batiam entrada por entrada, com 0 diferencas, e mesmo assim ganhavam
# marcador novo. Publicar de outra maquina custava 28 MB de download a cada
# jogador para entregar os arquivos que ele ja' tinha.
#
# O campo `sha256` do manifesto continua sendo o do ARQUIVO: e' o que o cliente
# confere depois de baixar, e ali o que importa e' o zip ter chegado inteiro.
# Sao perguntas diferentes — "preciso baixar?" e "o que baixei esta' intacto?".
#
# Custo: ~1,7s no cards.zip (27 MB). Roda uma vez por publicacao.
function DigitalDoConteudo($zipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $linhas = [System.Collections.Generic.List[string]]::new()
    $buf = New-Object byte[] 131072
    foreach ($e in $zip.Entries) {
      $ms = New-Object System.IO.MemoryStream
      $s = $e.Open()
      try { while (($n = $s.Read($buf, 0, $buf.Length)) -gt 0) { $ms.Write($buf, 0, $n) } }
      finally { $s.Dispose() }
      $h = [System.BitConverter]::ToString($sha.ComputeHash($ms.ToArray())).Replace('-', '').ToLowerInvariant()
      $ms.Dispose()
      $linhas.Add("$($e.FullName)|$h")
    }
    # Ordinal, e nao Sort-Object: a ordenacao por CULTURA muda de maquina, que e'
    # justamente o tipo de diferenca que esta funcao existe para nao ter.
    $linhas.Sort([StringComparer]::Ordinal)
    $tudo = [System.Text.Encoding]::UTF8.GetBytes(($linhas -join "`n"))
    return [System.BitConverter]::ToString($sha.ComputeHash($tudo)).Replace('-', '').ToLowerInvariant()
  }
  finally { $zip.Dispose() }
}

# O GitHub RENOMEIA assets ao subir (espacos e especiais viram '.'). Gravamos o
# campo `asset` ja' sanitizado; o cliente tambem tenta o nome cru, para manifestos
# antigos nao quebrarem. Arrumar so' uma ponta deixa o outro lado torto.
function NomeSeguro($nome) { [regex]::Replace($nome, '[^A-Za-z0-9._-]', '.') }

# Onde esta o gh.exe.
#
# Nao basta `Get-Command gh`: o MSI do GitHub CLI escreve o PATH no REGISTRO, e
# todo processo aberto ANTES da instalacao continua com a copia velha do PATH -
# inclusive o terminal onde voce roda `npm`, que repassa a dele para este
# powershell filho. O sintoma e' cruel: `gh --version` responde na sua janela e
# mesmo assim o script diz "o gh CLI nao esta no PATH".
#
# Entao: PATH do processo -> PATH do registro -> os tres caminhos de instalacao
# padrao. So' desiste depois disso.
function AcharGh {
  $c = Get-Command gh -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }

  $doRegistro = @([Environment]::GetEnvironmentVariable('PATH', 'Machine'),
                  [Environment]::GetEnvironmentVariable('PATH', 'User')) -join ';'
  foreach ($dir in ($doRegistro -split ';')) {
    if ([string]::IsNullOrWhiteSpace($dir)) { continue }
    $p = try { Join-Path $dir 'gh.exe' } catch { $null }
    if ($p -and (Test-Path $p)) { return $p }
  }

  foreach ($p in @("$env:ProgramFiles\GitHub CLI\gh.exe",
                   "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
                   "$env:LOCALAPPDATA\GitHubCLI\gh.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Copiar($de, $para) {
  $pai = Split-Path -Parent $para
  if (-not (Test-Path $pai)) { New-Item -ItemType Directory -Path $pai -Force | Out-Null }
  Copy-Item $de $para -Recurse -Force
}

Write-Host "`n  ####  CLASSIC DUELS - PUBLICAR ATUALIZACAO  ####" -ForegroundColor Yellow
if (-not $Publish) { Aviso 'DRY-RUN (nada sera publicado). Use -Publish para subir.' }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $saida) { Remove-Item $saida -Recurse -Force }
New-Item -ItemType Directory -Path $saida -Force | Out-Null

# ------------------------------------------------------- 1. pacote 'game' (leve)
# web/ + a API de consulta + os indices pequenos. E' o que muda quase todo dia:
# manter isto separado e' o que faz um ajuste de front custar ~3 MB ao jogador em
# vez dos ~50 MB do pacote inteiro.
Passo 1 "montando o pacote 'game' (front + indices)"
$g = Join-Path $stage 'game'
Copiar (Join-Path $root 'web')          (Join-Path $g 'web')
Copiar (Join-Path $root 'ygo-data\src') (Join-Path $g 'ygo-data\src')

# `boards/*.json` NUNCA viajou - nem no Release nem na semente do pack - e por
# isso o jogo instalado nao tinha a pasta `boards/` de jeito nenhum. Sem ela o
# `/__boards/list` volta vazio, o `duel.html` nao acha o tabuleiro do adversario
# e cai no layout padrao do `boards.js`, sem Bonus de Campo. No `npm run dev`
# funcionava (o servidor le a pasta do repositorio), entao o buraco so' aparecia
# no `.exe`: o Weevil perdia a Forest e o campo virava o generico.
#
# Sao conteudo do jogo, versionados de proposito (boards/README.md), e por isso
# entram no pacote 'game' junto com o front - nao na semente: assim um tabuleiro
# corrigido chega por atualizacao, sem exigir um exe novo.
#
# Antes de empacotar, o banco desce para o disco: e' o que faz um campo criado
# DENTRO do jogo entrar no payload e no git sozinho.
SincronizarTabuleiros
# Os decks de NPC nao entram no game.zip (eles viajam na semente do pack), mas
# a sincronia mora aqui do mesmo jeito: e' o unico passo que roda antes de
# empacotar e ve' o banco, e e' o que mantem o git em dia com o que foi montado
# dentro do jogo.
SincronizarDecksNpc
$tabuleiros = Get-ChildItem (Join-Path $root 'boards') -Filter '*.json' -File -ErrorAction SilentlyContinue
foreach ($b in $tabuleiros) { Copiar $b.FullName (Join-Path $g "boards\$($b.Name)") }
Ok "$($tabuleiros.Count) tabuleiro(s)"
foreach ($f in @('cards.index.json','archetypes.json','scripts.index.json','meta.json','constants.json')) {
  $de = Join-Path $root "ygo-data\data\$f"
  if (-not (Test-Path $de)) { Falhar "nao achei ygo-data\data\$f (rode npm run data:build)" }
  Copiar $de (Join-Path $g "ygo-data\data\$f")
}
$zipGame = Join-Path $saida 'game.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($g, $zipGame, 'Optimal', $false)
Ok "game.zip: $([math]::Round((Get-Item $zipGame).Length / 1MB, 1)) MB"

# ------------------------------------------------------ 2. pacote 'cards' (pesado)
# cards.json + cards.cdb + os ~21 mil scripts lua. So' muda quando roda o
# data:build, entao o marcador de versao poupa o jogador de re-baixar 47 MB.
#
# ESTE PASSO ERA O DONO DO RELOGIO. Medido em 16/08/2026, nos 20.949 .lua
# (41,6 MB, media de 2 KB por arquivo):
#
#     CreateFromDirectory 'Optimal'  ->  278,3 s   24,6 MB
#     CreateFromDirectory 'Fastest'  ->    6,1 s   25,6 MB
#
# 45x mais lento para economizar 1 MB (4%). O deflate no nivel maximo e'
# patologico com muito arquivo minusculo: ele paga a otimizacao POR ENTRADA,
# 21 mil vezes. E ate aqui isso rodava a cada publicacao, mesmo quando o banco
# nao tinha mudado nada - o marcador saia identico (`cards-416a0904cf12` em
# todas as publicacoes do dia), ou seja, ~5 minutos por ciclo para produzir um
# arquivo que ja' existia.
#
# Duas correcoes, nesta ordem de importancia:
#
#   1. CACHE por impressao digital das ENTRADAS (caminho + tamanho + data de
#      cada arquivo). Bateu, reaproveita o zip inteiro de `dist\.cache` - sem
#      copiar 21 mil arquivos para o estagio e sem comprimir nada. E' o caso
#      comum: mudanca de front ou de motor nao toca no banco de cartas.
#      Reaproveitar o zip BYTE A BYTE tambem preserva o `version` do manifesto
#      (que e' o sha256 do proprio zip), entao ninguem re-baixa a toa.
#   2. 'Fastest' quando ele PRECISA ser refeito. O 1 MB a mais so' e' pago no
#      dia raro em que o banco muda - e nesse dia o conteudo mudou de qualquer
#      forma, entao o download ja' aconteceria.
#
# A digital usa tamanho+data em vez do hash do conteudo de proposito: ler 41 MB
# em 21 mil arquivos para decidir se vale a pena nao ler 41 MB seria trocar seis
# por meia duzia. Data mexida sem conteudo novo (um checkout, por exemplo) so'
# custa uma recompressao de 6 s.
Passo 2 "montando o pacote 'cards' (banco + scripts lua)"

$saOrigem  = Join-Path $root 'duel_academy\Assets\StreamingAssets\YGODemo'
if (-not (Test-Path (Join-Path $saOrigem 'cards.cdb'))) { Falhar 'nao achei o cards.cdb dos StreamingAssets' }
$scriptOrigem = Join-Path $saOrigem 'script'
# Os .meta sao lixo da Unity: dobrariam a contagem de arquivos sem servir a nada.
$luas = Get-ChildItem $scriptOrigem -Recurse -Filter '*.lua' -File

$entradas = @(
  (Get-Item (Join-Path $root 'ygo-data\data\cards.json')),
  (Get-Item (Join-Path $saOrigem 'cards.cdb'))
) + $luas
$digital = ($entradas | Sort-Object FullName | ForEach-Object {
  "$($_.Name)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)"
}) -join "`n"
$digital = [System.BitConverter]::ToString(
  [System.Security.Cryptography.SHA256]::Create().ComputeHash(
    [System.Text.Encoding]::UTF8.GetBytes($digital))).Replace('-', '').ToLowerInvariant()

$cache      = Join-Path $root 'dist\.cache'
$cacheZip   = Join-Path $cache 'cards.zip'
$cacheDigit = Join-Path $cache 'cards.digital'
$zipCards   = Join-Path $saida 'cards.zip'

$reaproveita = (Test-Path $cacheZip) -and (Test-Path $cacheDigit) -and
               ((Get-Content $cacheDigit -Raw).Trim() -eq $digital)

if ($reaproveita) {
  Copy-Item $cacheZip $zipCards -Force
  Ok "cards.zip: $([math]::Round((Get-Item $zipCards).Length / 1MB, 1)) MB - reaproveitado do cache ($($luas.Count) scripts lua, nada mudou)"
}
else {
  # Zipa DIRETO da origem, sem passar por uma pasta de estagio.
  #
  # Copiar os 21 mil .lua para o estagio custava ~200 s - mais do que a propria
  # compressao depois do 'Fastest' (medido: 207 s no total, dos quais so' ~6 s
  # eram o deflate). Sao 21 mil criacoes de arquivo no NTFS para produzir uma
  # copia que existe por dez segundos e e' apagada em seguida.
  #
  # O separador das entradas e' a CONTRABARRA de proposito: e' o que o
  # `CreateFromDirectory` gerava no Windows, e portanto o que os pacotes ja'
  # publicados usam e o instalador espera. Trocar por barra aqui seria uma
  # mudanca invisivel no build e visivel so' na maquina do jogador.
  $entradasZip = @(
    @{ arq = (Join-Path $root 'ygo-data\data\cards.json'); nome = 'ygo-data\data\cards.json' },
    @{ arq = (Join-Path $saOrigem 'cards.cdb');
       nome = 'duel_academy\Assets\StreamingAssets\YGODemo\cards.cdb' }
  )
  foreach ($lua in $luas) {
    $rel = $lua.FullName.Substring($scriptOrigem.Length).TrimStart('\')
    $entradasZip += @{ arq = $lua.FullName
                       nome = "duel_academy\Assets\StreamingAssets\YGODemo\script\$rel" }
  }

  Add-Type -AssemblyName System.IO.Compression
  if (Test-Path $zipCards) { Remove-Item $zipCards -Force }
  $fsCards = [System.IO.File]::Create($zipCards)
  $zipArq = New-Object System.IO.Compression.ZipArchive($fsCards, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($e in $entradasZip) {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zipArq, $e.arq, $e.nome, [System.IO.Compression.CompressionLevel]::Fastest) | Out-Null
    }
  }
  finally { $zipArq.Dispose(); $fsCards.Dispose() }

  New-Item -ItemType Directory -Path $cache -Force | Out-Null
  Copy-Item $zipCards $cacheZip -Force
  Set-Content -Path $cacheDigit -Value $digital -Encoding ascii
  Ok "cards.zip: $([math]::Round((Get-Item $zipCards).Length / 1MB, 1)) MB ($($luas.Count) scripts lua) - refeito e guardado no cache"
}

# --------------------------------------------------- 2.5 pacotes do MOTOR (C#)
# O motor (ocgcore + NpcBrain + InteractiveDuel + servidor web) e' um
# DuelServer.Engine.dll de ~800 KB carregado pela casca em tempo de execucao.
#
# ISTO E' O QUE MATOU O "REENVIA O EXE". Ate' 19/08/2026 todo o C# viajava
# dentro do ClassicDuels.exe, entao entregar uma correcao no NpcBrain custava
# 67,8 MB ao jogador - dos quais ~30 MB eram game.zip e cards.zip que ele ja'
# tinha no disco - e dependia de um ritual manual (`pack` + bump da
# InstallerVersion + `-ComExe`) que ja' foi esquecido em producao: o front subiu,
# o motor ficou velho, e nenhum teste acusou.
#
# Sao DOIS pacotes por volatilidade, a mesma logica de game/cards:
#   engine  o .dll gerenciado  (~400 KB)  muda a cada mexida em C#
#   native  ocgcore + sqlite3  (~2 MB)    muda quando o core e' recompilado
#
# As entradas vao com o prefixo `.staged/`: quem baixa a atualizacao e' o
# proprio motor, e nesse instante ele e a ocgcore.dll estao carregados - o
# Windows nao deixa sobrescrever DLL em uso. O pacote fica em estagio e a casca
# aplica no boot seguinte (duel-server/host/Estagio.cs).
Passo '2.5' "montando os pacotes 'engine' e 'native' (o motor em C#)"

$projMotor = Join-Path $root 'duel-server\engine\duel-engine.csproj'
$saidaMotor = Join-Path $stage 'motor'
& dotnet build $projMotor -c Release -o $saidaMotor -v q --nologo | Out-Null
if ($LASTEXITCODE -ne 0) { Falhar 'o build do motor (duel-engine) falhou' }

$dllMotor = Join-Path $saidaMotor 'DuelServer.Engine.dll'
if (-not (Test-Path $dllMotor)) { Falhar "nao achei $dllMotor depois do build" }

# Zip com data FIXA nas entradas. Sem isto, dois builds do MESMO fonte geram
# zips diferentes (o zip guarda o timestamp de cada arquivo), o marcador do
# manifesto - que e' o sha256 do zip - muda toda publicacao e TODO jogador
# re-baixa o motor a' toa, com direito a tela de atualizacao. O compilador ja'
# e' determinista (`<Deterministic>` no .csproj); faltava o empacotador ser.
function ZipDeterminista($mapa, $destino) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $destino) { Remove-Item $destino -Force }
  $data = [DateTimeOffset]::new(2020, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
  $fs = [System.IO.File]::Create($destino)
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($nome in ($mapa.Keys | Sort-Object)) {
      $e = $zip.CreateEntry($nome, [System.IO.Compression.CompressionLevel]::Optimal)
      $e.LastWriteTime = $data
      $saidaEntrada = $e.Open()
      try {
        $bytes = [System.IO.File]::ReadAllBytes($mapa[$nome])
        $saidaEntrada.Write($bytes, 0, $bytes.Length)
      }
      finally { $saidaEntrada.Dispose() }
    }
  }
  finally { $zip.Dispose(); $fs.Dispose() }
}

$zipEngine = Join-Path $saida 'engine.zip'
ZipDeterminista @{ '.staged/engine/DuelServer.Engine.dll' = $dllMotor } $zipEngine
Ok "engine.zip: $([math]::Round((Get-Item $zipEngine).Length / 1KB, 0)) KB"

$nativas = @{}
foreach ($n in @('ocgcore.dll', 'sqlite3.dll')) {
  $de = Join-Path $root "duel-server\native\$n"
  if (-not (Test-Path $de)) { Falhar "nao achei duel-server\native\$n" }
  $nativas[".staged/engine/$n"] = $de
}
$zipNative = Join-Path $saida 'native.zip'
ZipDeterminista $nativas $zipNative
Ok "native.zip: $([math]::Round((Get-Item $zipNative).Length / 1MB, 1)) MB"

# ------------------------------------------------------------- 3. arquivos avulsos
# CONTEUDO GLOBAL do jogo (banlist, boosters, NPCs, listas de cartas) -
# versionado de proposito.
# O resto de store/ e decks/ e' dado de CONTA e o cliente recusa por codigo,
# mesmo que um manifesto peca.
Passo 3 'coletando o conteudo global (store/*.json)'
# `store/npc-base-meta.json` e' OPCIONAL de nascenca: ele so' existe depois que
# alguem edita nivel/campanha/tabuleiro de um dos 3 NPCs fixos (BASE_NPCS e' um
# array const no codigo, entao esses campos moram num overlay a' parte). Nao
# avisamos por ele - um aviso amarelo que aparece toda vez e nunca significa nada
# so' ensina a ignorar os avisos que importam.
$opcionais = @('store/npc-base-meta.json')
$avulsos = @()
foreach ($rel in @('store/banlist.json','store/boosters.json','store/npcs.json','store/npc-base-meta.json','store/cardlists.json')) {
  $de = Join-Path $root ($rel -replace '/','\')
  if (-not (Test-Path $de)) {
    if ($opcionais -notcontains $rel) { Aviso "sem $rel (pulando)" }
    continue
  }
  $nome = NomeSeguro (Split-Path -Leaf $rel)
  Copy-Item $de (Join-Path $saida $nome) -Force
  $avulsos += [ordered]@{
    path   = $rel
    sha256 = Sha256 $de
    size   = (Get-Item $de).Length
    asset  = $nome
    policy = 'required'
  }
}
Ok "$($avulsos.Count) arquivo(s) global(is)"

# ------------------------------------------------------------------ 4. manifesto
Passo 4 'escrevendo o manifest.json'

function PayloadInfo($id, $zip, $roots) {
  $sha = Sha256 $zip                      # o ARQUIVO: e' o que o cliente confere
  $digital = DigitalDoConteudo $zip       # o que esta' DENTRO: e' o que decide baixar
  [ordered]@{
    id      = $id
    # Identidade pelo CONTEUDO — nao da' para esquecer de incrementar, e nao muda
    # so' porque o zip foi montado noutra maquina. Ver DigitalDoConteudo.
    version = "$id-$($digital.Substring(0,12))"
    asset   = NomeSeguro (Split-Path -Leaf $zip)
    sha256  = $sha
    size    = (Get-Item $zip).Length
    roots   = $roots
  }
}

# ------------------------------------------------------------- o exe no manifesto
# O campo `installer` vai SEMPRE que houver um exe empacotado em dist\ - nao so'
# com -ComExe.
#
# POR QUE. O cliente so' descobre que existe um executavel novo por este campo
# (`UpdateEngine.Montar`: `if (m.Installer != null) …`). Com ele nulo, quem esta'
# com um exe antigo nao e' avisado de nada — e desde 19/08/2026 isso deixou de
# ser um detalhe cosmetico: o MOTOR passou a viajar como pacote em `.staged/`, e
# quem aplica o estagio e' a CASCA do exe >= 0.15.0. Um exe 0.14.x baixa o
# `engine.zip`, ele fica parado em `.staged/` e nada o carrega — front novo,
# motor congelado PARA SEMPRE, sem um erro sequer.
#
# Nao e' hipotese: so' os dois Releases de 19/08/2026 sairam com o exe, e todos
# os seguintes com `installer: null`. Quem nao abriu o jogo naquela janela de 25
# minutos ficou preso — e o sintoma, do lado de quem joga, e' a magia de campo do
# tabuleiro entrando do lado errado e o ATK/DEF sem aparecer na carta, dois
# consertos publicados no repositorio ha' dias.
#
# O custo e' de quem PUBLICA (~66 MB de upload), nunca de quem joga: o cliente
# compara `installer.version` com a compilada dentro dele e nao baixa nada quando
# sao iguais. `-ComExe` continua aceito e agora significa so' "exija o exe":
# falha em vez de avisar quando dist\ClassicDuels.exe nao existe.
$exe = Join-Path $root 'dist\ClassicDuels.exe'
$instalador = $null
if (-not (Test-Path $exe)) {
  if ($ComExe) { Falhar 'nao achei dist\ClassicDuels.exe (rode npm run pack antes de -ComExe)' }
  Aviso 'nao achei dist\ClassicDuels.exe — o manifesto vai SEM `installer`.'
  Write-Host "       Quem tiver um exe antigo nao sera' avisado de que existe um novo, e um" -ForegroundColor Yellow
  Write-Host "       exe anterior a 0.15.0 nao aplica o motor que ele mesmo baixa." -ForegroundColor Yellow
  Write-Host "       Rode npm run pack antes de publicar." -ForegroundColor Yellow
} else {
  # A casca (duel-server\host) e' a unica parte que ainda viaja DENTRO do exe.
  # Publicar um exe empacotado antes da ultima mexida nela entregaria uma casca
  # velha carregando um motor novo, em silencio. A digital e' gravada pelo
  # `npm run pack` (dist\.cache\casca.digital) e comparada por CONTEUDO.
  $digitalPack = Join-Path $root 'dist\.cache\casca.digital'
  $agoraCasca = DigitalDaCasca $root
  if ((Test-Path $digitalPack) -and $agoraCasca) {
    $doPack = (Get-Content $digitalPack -Raw).Trim()
    if ($doPack -and $doPack -ne $agoraCasca) {
      Falhar 'a casca (duel-server\host) mudou depois do ultimo `npm run pack`: o exe em dist\ esta velho. Rode npm run pack.'
    }
  }

  # O EXE EMBUTE O MESMO CONTEUDO QUE ESTE RELEASE PUBLICA?
  #
  # A digital da casca (acima) responde "o exe tem o CODIGO mais novo". Esta
  # responde a outra metade, que ela nao ve': "o exe tem o CONTEUDO mais novo".
  # Um `pack` rodado antes do ultimo `release:build` produz um exe que embute um
  # game.zip mais velho que o game.zip deste mesmo Release.
  #
  # Isso ja' aconteceu (24/08/2026) e o estrago foi um LACO INFINITO de
  # atualizacao: o cliente baixava o Release, trocava o exe, e o boot seguinte
  # reinstalava a semente embutida por cima do que acabara de baixar, carimbando
  # o marcador velho. A checagem seguinte oferecia a MESMA atualizacao. Para
  # sempre — e o jogador ficava preso no front da data do `pack`, rodando contra
  # um banco que ja' tinha seguido em frente.
  #
  # O `Payload.ExtrairPacote` nao rebaixa mais um pacote que ja' tem marcador em
  # disco, entao o laco esta' fechado do lado do cliente. Esta trava impede de
  # PUBLICAR o descompasso, que mesmo sem laco entrega conteudo velho a toda
  # INSTALACAO NOVA — ela nasce sem marcador e por isso confia na semente.
  $marcadoresPack = Join-Path $root 'dist\.cache\payload.markers'
  if (Test-Path $marcadoresPack) {
    $embutido = @{}
    foreach ($linha in Get-Content $marcadoresPack) {
      if ($linha -match '^\s*([a-z0-9_-]+)\s*=\s*(\S+)\s*$') { $embutido[$Matches[1]] = $Matches[2] }
    }
    $fora = @()
    foreach ($par in @(@{ id = 'game';   zip = $zipGame },
                       @{ id = 'cards';  zip = $zipCards },
                       @{ id = 'engine'; zip = $zipEngine },
                       @{ id = 'native'; zip = $zipNative })) {
      if (-not $par.zip -or -not (Test-Path $par.zip)) { continue }
      $agora = "$($par.id)-$((DigitalDoConteudo $par.zip).Substring(0,12))"
      if ($embutido.ContainsKey($par.id) -and $embutido[$par.id] -ne $agora) {
        $fora += "$($par.id): o exe embute $($embutido[$par.id]), este Release publica $agora"
      }
    }
    if ($fora.Count -gt 0) {
      foreach ($f in $fora) { Write-Host "       $f" -ForegroundColor Yellow }
      # SO' NO -Publish. O dry-run e' JUSTAMENTE como se geram os zips que o
      # `npm run pack` consome, entao falhar aqui trancaria a saida: o
      # release:build morreria antes de escrever o manifest.json, e o pack
      # seguinte nao teria o que ler ("nao achei dist\release\manifest.json").
      # A sequencia correta e' release:build -> pack -> publish, e a trava tem de
      # morder no ULTIMO passo, nao no primeiro.
      if ($Publish) {
        Falhar 'o exe em dist\ foi empacotado a partir de outro release:build. Rode npm run pack de novo e publique.'
      }
      Aviso 'o exe em dist\ ficou defasado - rode npm run pack antes de publicar.'
    } else {
      Ok 'o exe embute exatamente o conteudo deste Release'
    }
  } else {
    Aviso 'dist\.cache\payload.markers nao existe - nao da para conferir se o exe embute este conteudo. Rode npm run pack.'
  }

  $versao = Select-String -Path (Join-Path $root 'duel-server\src\update\BuildConfig.cs') `
                          -Pattern 'InstallerVersion\s*=\s*"([^"]+)"' | Select-Object -First 1
  if (-not $versao) { Falhar 'nao consegui ler a InstallerVersion do BuildConfig.cs' }
  $v = $versao.Matches[0].Groups[1].Value
  Copy-Item $exe (Join-Path $saida 'ClassicDuels.exe') -Force
  $instalador = [ordered]@{
    version = $v
    asset   = 'ClassicDuels.exe'
    sha256  = Sha256 $exe
    size    = (Get-Item $exe).Length
  }
  Ok "instalador $v ($([math]::Round((Get-Item $exe).Length / 1MB, 1)) MB)"
}

$manifesto = [ordered]@{
  gameVersion  = "classic-duels-$(Get-Date -Format 'yyyyMMdd-HHmm')"
  displayName  = 'Classic Duels'
  installer    = $instalador
  # `web/` foi o primeiro a sair de "keep", como o plano previa: e' a raiz que o
  # inventario do pacote 'game' cobre inteira, entao "orfao" ali quer dizer
  # mesmo "sobra de uma versao anterior" - e um .js velho que fica no disco para
  # sempre e' justamente o tipo de coisa que carrega em silencio e quebra a
  # pagina. "backup" nao apaga nada: move para %LOCALAPPDATA%\ClassicDuels\backups
  # preservando o caminho, e o botao "voltar para a versao anterior" da tela de
  # atualizacao devolve tudo.
  #
  # As outras duas continuam em "keep" de proposito: `ygo-data` e
  # `StreamingAssets` sao compartilhadas entre os dois pacotes e tem arquivos que
  # o `data:build` gera localmente. Virar uma de cada vez, so' depois de ver uma
  # atualizacao real rodando limpa (MECANISMO-INSTALADOR.md §9.9).
  managedRoots = @(
    [ordered]@{ path = 'web';                                 removeMode = 'backup' },
    [ordered]@{ path = 'ygo-data';                            removeMode = 'keep' },
    [ordered]@{ path = 'duel_academy/Assets/StreamingAssets'; removeMode = 'keep' }
  )
  files    = $avulsos
  payloads = @(
    # `boards` entra nas roots do pacote para o INVENTARIO cobri-la: um tabuleiro
    # que sai do jogo tem de sumir do disco do jogador. Fora do managedRoots de
    # proposito - a limpeza e' por inventario, entao o tabuleiro que o JOGADOR
    # criou no editor nunca esteve la' e sobrevive a atualizacao.
    (PayloadInfo 'game'  $zipGame  @('web','ygo-data/src','ygo-data/data','boards')),
    (PayloadInfo 'cards' $zipCards @('ygo-data/data','duel_academy/Assets/StreamingAssets/YGODemo')),
    # `.staged/` nas roots nao e' decoracao: e' POR ELA que o cliente sabe que o
    # pacote so' vale depois de reabrir o jogo (Manifest.EmEstagio). Publicar um
    # zip que cai em estagio sem isso faria a tela dizer "pronto" com o motor
    # velho ainda rodando.
    (PayloadInfo 'engine' $zipEngine @('.staged/engine')),
    (PayloadInfo 'native' $zipNative @('.staged/engine'))
  )
}

# SEM BOM: o Set-Content/Out-File do PowerShell adiciona BOM, e o parser do
# cliente tolera - mas quem escreve um manifesto na mao depois nao teria essa
# sorte com outro parser. Grave certo na origem.
$json = $manifesto | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText((Join-Path $saida 'manifest.json'), $json,
                               (New-Object System.Text.UTF8Encoding($false)))
Ok "manifest.json ($($json.Length) bytes)"

Remove-Item $stage -Recurse -Force

# ------------------------------------------------------------------- 5. publicar
if (-not $Publish) {
  Write-Host "`n  DRY-RUN pronto em dist\release\ - confira e rode de novo com -Publish.`n" -ForegroundColor Green
  Get-ChildItem $saida | ForEach-Object {
    Write-Host ("    {0,-24} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB))
  }
  exit 0
}

Passo 5 'publicando o Release'
$gh = AcharGh
if (-not $gh) {
  Write-Host '  ERRO nao achei o gh CLI.' -ForegroundColor Red
  Write-Host '       instale em https://cli.github.com e rode `gh auth login`.' -ForegroundColor Red
  exit 1
}
Ok "gh: $gh"

# A conta precisa de ESCRITA no repo de distribuicao. Sem esta checagem o erro
# so' apareceria como um 403 do `release create`, depois de subir 25 MB de asset.
$perm = (& $gh repo view "$owner/$repo" --json viewerPermission -q .viewerPermission 2>$null)
if ($LASTEXITCODE -ne 0) { Falhar "nao consegui consultar $owner/$repo - rode: gh auth login" }
if ($perm -notin @('WRITE', 'ADMIN', 'MAINTAIN')) {
  Falhar "a conta autenticada tem permissao '$perm' em $owner/$repo - precisa de WRITE"
}

if ($Tag -eq '') { $Tag = "release-$(Get-Date -Format 'yyyyMMdd-HHmm')" }

$assets = Get-ChildItem $saida -File | ForEach-Object { $_.FullName }
# Sem --draft e sem --prerelease, de proposito: o cliente busca /releases/latest,
# e esse endpoint IGNORA os dois. Um Release marcado como rascunho publica "com
# sucesso" e nenhum jogador ve' a atualizacao - e nada acusa.
& $gh release create $Tag @assets --repo "$owner/$repo" --title $Tag `
    --notes "Atualizacao automatica - $($manifesto.gameVersion)"
if ($LASTEXITCODE -ne 0) { Falhar 'o gh release create falhou' }

Ok "Release $Tag publicado em $owner/$repo"

# --------------------------------------------------------- 6. podar os antigos
$todos = & $gh release list --repo "$owner/$repo" --limit 200 --json tagName,createdAt |
         ConvertFrom-Json | Sort-Object createdAt -Descending
if ($PodarReleases -gt 0) {
  Passo 6 "podando os Releases antigos (mantendo $PodarReleases)"
  $velhos = $todos | Select-Object -Skip $PodarReleases
  foreach ($r in $velhos) {
    & $gh release delete $r.tagName --repo "$owner/$repo" --yes --cleanup-tag
    if ($LASTEXITCODE -eq 0) { Ok "removido: $($r.tagName)" }
    else { Aviso "nao consegui remover $($r.tagName)" }
  }
  if (-not $velhos) { Ok 'nada a podar' }
}
elseif ($todos.Count -gt 10) {
  Aviso "$($todos.Count) Releases no repositorio. Para limpar: npm run release:publish -- -PodarReleases 5"
}

Write-Host "`n  Os clientes pegam sozinhos no proximo boot (/releases/latest).`n" -ForegroundColor Green
