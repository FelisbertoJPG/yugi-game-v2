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
  # Suba junto o exe novo (auto-update do proprio instalador). Precisa de um
  # `npm run pack` feito antes, e do bump da InstallerVersion no BuildConfig.cs.
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
$stage   = Join-Path $env:TEMP 'duel-academy-release'

$owner = 'FelisbertoJPG'
$repo  = 'yugi-server-'

function Passo($n, $t) { Write-Host "`n[$n] $t" -ForegroundColor Cyan }
function Ok($t)        { Write-Host "  OK   $t" -ForegroundColor Green }
function Aviso($t)     { Write-Host "  !    $t" -ForegroundColor Yellow }
function Falhar($t)    { Write-Host "  ERRO $t" -ForegroundColor Red; exit 1 }

function Sha256($caminho) {
  (Get-FileHash -Algorithm SHA256 -Path $caminho).Hash.ToLowerInvariant()
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

Write-Host "`n  ####  DUEL ACADEMY - PUBLICAR ATUALIZACAO  ####" -ForegroundColor Yellow
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
Passo 2 "montando o pacote 'cards' (banco + scripts lua)"
$c = Join-Path $stage 'cards'
Copiar (Join-Path $root 'ygo-data\data\cards.json') (Join-Path $c 'ygo-data\data\cards.json')

$saOrigem  = Join-Path $root 'duel_academy\Assets\StreamingAssets\YGODemo'
$saDestino = Join-Path $c    'duel_academy\Assets\StreamingAssets\YGODemo'
if (-not (Test-Path (Join-Path $saOrigem 'cards.cdb'))) { Falhar 'nao achei o cards.cdb dos StreamingAssets' }
Copiar (Join-Path $saOrigem 'cards.cdb') (Join-Path $saDestino 'cards.cdb')

# Os .meta sao lixo da Unity: dobrariam a contagem de arquivos sem servir a nada.
$scriptOrigem = Join-Path $saOrigem 'script'
$luas = Get-ChildItem $scriptOrigem -Recurse -Filter '*.lua' -File
foreach ($lua in $luas) {
  $rel = $lua.FullName.Substring($scriptOrigem.Length).TrimStart('\')
  Copiar $lua.FullName (Join-Path (Join-Path $saDestino 'script') $rel)
}
$zipCards = Join-Path $saida 'cards.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($c, $zipCards, 'Optimal', $false)
Ok "cards.zip: $([math]::Round((Get-Item $zipCards).Length / 1MB, 1)) MB ($($luas.Count) scripts lua)"

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
  $sha = Sha256 $zip
  [ordered]@{
    id      = $id
    version = "$id-$($sha.Substring(0,12))"   # identidade pelo CONTEUDO: nao da'
    asset   = NomeSeguro (Split-Path -Leaf $zip)  # para esquecer de incrementar
    sha256  = $sha
    size    = (Get-Item $zip).Length
    roots   = $roots
  }
}

$exe = Join-Path $root 'dist\DuelAcademy.exe'
$instalador = $null
if ($ComExe) {
  if (-not (Test-Path $exe)) { Falhar 'nao achei dist\DuelAcademy.exe (rode npm run pack antes de -ComExe)' }
  $versao = Select-String -Path (Join-Path $root 'duel-server\src\update\BuildConfig.cs') `
                          -Pattern 'InstallerVersion\s*=\s*"([^"]+)"' | Select-Object -First 1
  if (-not $versao) { Falhar 'nao consegui ler a InstallerVersion do BuildConfig.cs' }
  $v = $versao.Matches[0].Groups[1].Value
  Copy-Item $exe (Join-Path $saida 'DuelAcademy.exe') -Force
  $instalador = [ordered]@{
    version = $v
    asset   = 'DuelAcademy.exe'
    sha256  = Sha256 $exe
    size    = (Get-Item $exe).Length
  }
  Ok "instalador $v ($([math]::Round((Get-Item $exe).Length / 1MB, 1)) MB)"
}

$manifesto = [ordered]@{
  gameVersion  = "duel-academy-$(Get-Date -Format 'yyyyMMdd-HHmm')"
  displayName  = 'Duel Academy'
  installer    = $instalador
  # `web/` foi o primeiro a sair de "keep", como o plano previa: e' a raiz que o
  # inventario do pacote 'game' cobre inteira, entao "orfao" ali quer dizer
  # mesmo "sobra de uma versao anterior" - e um .js velho que fica no disco para
  # sempre e' justamente o tipo de coisa que carrega em silencio e quebra a
  # pagina. "backup" nao apaga nada: move para %LOCALAPPDATA%\DuelAcademy\backups
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
    (PayloadInfo 'cards' $zipCards @('ygo-data/data','duel_academy/Assets/StreamingAssets/YGODemo'))
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
