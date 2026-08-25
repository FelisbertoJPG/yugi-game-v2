# Gera dist\ClassicDuels.exe - o jogo inteiro num arquivo so'.
#
# O executavel sai self-contained (o .NET vai dentro dele) e com um payload.zip
# embutido contendo o jogo. Quem recebe nao precisa de .NET, nem de Node, nem do
# repositorio: dois cliques e joga.
#
#   npm run release:build     <-- PRE-REQUISITO (gera dist\release\)
#   npm run pack
#
# POR QUE O PRE-REQUISITO. O payload embutido nao monta mais a propria arvore de
# arquivos: ele embute os MESMOS game.zip / cards.zip que o publish-release.ps1
# acabou de gerar, mais um payload.markers com as versoes deles (lidas do
# manifest.json). O diff do auto-updater e' por MARCADOR, e o marcador vem do
# sha256 do zip - e dois `CreateFromDirectory` sobre o mesmo conteudo NAO produzem
# bytes iguais (o zip guarda o timestamp de cada entrada). Montando aqui, o
# marcador nunca casaria com o Release, e o primeiro boot de toda instalacao nova
# oferecia ~26 MB de atualizacao do conteudo que o proprio exe acabara de
# instalar. Consumindo os mesmos arquivos, a instalacao nova ja' nasce em dia.
#
# Requisitos AQUI (na maquina que empacota, nao na que joga): SDK do .NET 8.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP 'classic-duels-pack'
$payload = Join-Path $root 'duel-server\payload.zip'
$dist = Join-Path $root 'dist'
$release = Join-Path $dist 'release'
$saidaTmp = Join-Path $stage 'publish'

function Passo($n, $texto) { Write-Host "`n[$n] $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "  OK   $texto" -ForegroundColor Green }
function Aviso($texto) { Write-Host "  !    $texto" -ForegroundColor Yellow }
function Falhar($texto) { Write-Host "  ERRO $texto" -ForegroundColor Red; exit 1 }

# Impressao digital dos fontes da CASCA (duel-server\host). O `publicar.exe`
# calcula a mesma coisa em C# e compara — entao as duas contas tem de bater byte
# a byte. Formato: uma linha "caminho/relativo|sha256" por arquivo, ordenadas
# por ORDINAL (nao pela cultura, que muda de maquina), unidas por \n, e o sha256
# disso tudo em hex minusculo.
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

Write-Host "`n  ####  CLASSIC DUELS - EMPACOTAR  ####" -ForegroundColor Yellow

# --------------------------------------------------------- 0. conferir o release
Passo 0 'conferindo dist\release\ (gerado pelo npm run release:build)'

$zipGame = Join-Path $release 'game.zip'
$zipCards = Join-Path $release 'cards.zip'
# O MOTOR em C#. Ele viaja como pacote desde 19/08/2026: a casca o carrega do
# disco, entao uma correcao no NpcBrain chega ao jogador por ~400 KB em vez de
# um executavel inteiro. Aqui eles entram na SEMENTE, para uma instalacao nova
# ja' nascer com o motor no lugar (e com o marcador certo, senao o primeiro boot
# ofereceria de novo o que ele mesmo acabou de instalar).
$zipEngine = Join-Path $release 'engine.zip'
$zipNative = Join-Path $release 'native.zip'
$manifesto = Join-Path $release 'manifest.json'

foreach ($f in @($manifesto, $zipGame, $zipCards, $zipEngine, $zipNative)) {
  if (-not (Test-Path $f)) {
    Write-Host "  ERRO nao achei $f" -ForegroundColor Red
    Write-Host "       rode primeiro:  npm run release:build" -ForegroundColor Red
    exit 1
  }
}

$m = Get-Content $manifesto -Raw | ConvertFrom-Json
$versoes = @{}
foreach ($p in $m.payloads) { $versoes[$p.id] = $p.version }
foreach ($id in @('game', 'cards', 'engine', 'native')) {
  if (-not $versoes.ContainsKey($id)) { Falhar "o manifest.json nao tem o pacote '$id'" }
}

# O manifesto tem o sha256 de cada zip. Se nao bater, o dist\release\ foi mexido
# depois de gerado e os marcadores que vamos embutir seriam mentira - que e'
# exatamente o defeito que este script existe para nao cometer.
foreach ($par in @(@{ id = 'game'; zip = $zipGame }, @{ id = 'cards'; zip = $zipCards },
                   @{ id = 'engine'; zip = $zipEngine }, @{ id = 'native'; zip = $zipNative })) {
  $esperado = ($m.payloads | Where-Object { $_.id -eq $par.id }).sha256
  $atual = (Get-FileHash -Algorithm SHA256 -Path $par.zip).Hash.ToLowerInvariant()
  if ($atual -ne $esperado) {
    Falhar "$($par.id).zip nao confere com o manifest.json - rode npm run release:build de novo"
  }
}

# Release velho e' pior que release ausente: o exe sairia com um front antigo e
# nada acusaria. Compara o que ENTRA no game.zip com a data do proprio zip.
$dataZip = (Get-Item $zipGame).LastWriteTimeUtc
$maisNovo = Get-ChildItem (Join-Path $root 'web'), (Join-Path $root 'ygo-data\src') -Recurse -File |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if ($maisNovo -and $maisNovo.LastWriteTimeUtc -gt $dataZip) {
  Write-Host "  ERRO dist\release\game.zip esta' velho." -ForegroundColor Red
  Write-Host "       $($maisNovo.FullName.Substring($root.Length + 1)) mudou depois dele." -ForegroundColor Red
  Write-Host "       rode:  npm run release:build" -ForegroundColor Red
  exit 1
}

# O MESMO cuidado para o C#. Esta e' a checagem que substitui o ritual antigo de
# "mexeu em C#? lembre do -ComExe": um fonte mais novo que o engine.zip quer
# dizer que o Release nao leva a sua mudanca, e agora isso e' um erro em vez de
# uma linha no CLAUDE.md que da' para esquecer.
$fonteCs = Get-ChildItem (Join-Path $root 'duel-server\src'), (Join-Path $root 'duel-server\host') `
                         -Recurse -File -Filter '*.cs' -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if ($fonteCs -and $fonteCs.LastWriteTimeUtc -gt (Get-Item $zipEngine).LastWriteTimeUtc) {
  Write-Host "  ERRO dist
elease\engine.zip esta' velho." -ForegroundColor Red
  Write-Host "       $($fonteCs.FullName.Substring($root.Length + 1)) mudou depois dele." -ForegroundColor Red
  Write-Host "       rode:  npm run release:build" -ForegroundColor Red
  exit 1
}

Ok "game   $($versoes['game'])   $([math]::Round((Get-Item $zipGame).Length / 1MB, 1)) MB"
Ok "cards  $($versoes['cards'])  $([math]::Round((Get-Item $zipCards).Length / 1MB, 1)) MB"
Ok "engine $($versoes['engine']) $([math]::Round((Get-Item $zipEngine).Length / 1KB, 0)) KB"
Ok "native $($versoes['native']) $([math]::Round((Get-Item $zipNative).Length / 1MB, 1)) MB"

# ------------------------------------------------------------------ 1. semente
# O que os dois pacotes NAO trazem: o estado inicial de store/ e decks/ e o
# package.json (marcador da raiz). Numa instalacao que ja' existe, o Payload
# preserva esses arquivos em vez de sobrescrever - sao a carteira e os decks.
Passo 1 'juntando a semente (store/, decks/, package.json)'

$conteudo = Join-Path $stage 'payload'
$semente = Join-Path $conteudo 'seed'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $semente -Force | Out-Null

foreach ($p in @('decks', 'store')) {
  $origem = Join-Path $root $p
  if (-not (Test-Path $origem)) { Falhar "nao achei $p" }
  Copy-Item $origem (Join-Path $semente $p) -Recurse -Force
}
Copy-Item (Join-Path $root 'package.json') (Join-Path $semente 'package.json') -Force

# Dado de CONTA nunca viaja num executavel que vai para a maquina de outra
# pessoa. O cliente ja' recusa por codigo, mas nao ha' motivo para chegar la'.
foreach ($conta in @('store\accounts', 'store\users', 'store\sessions.json', 'decks\users')) {
  $alvo = Join-Path $semente $conta
  if (Test-Path $alvo) { Remove-Item $alvo -Recurse -Force; Aviso "removido do payload: $conta" }
}

$arquivosSemente = (Get-ChildItem $semente -Recurse -File)
Ok "$($arquivosSemente.Count) arquivos de semente"

# ------------------------------------------------------------------- 2. payload
Passo 2 'montando o payload.zip'

Copy-Item $zipGame (Join-Path $conteudo 'game.zip') -Force
Copy-Item $zipCards (Join-Path $conteudo 'cards.zip') -Force
Copy-Item $zipEngine (Join-Path $conteudo 'engine.zip') -Force
Copy-Item $zipNative (Join-Path $conteudo 'native.zip') -Force

# As versoes viajam junto porque o Payload nao tem como recalcula-las: elas sao o
# sha256 do zip PUBLICADO, e recomprimir aqui daria outro numero.
$linhas = @("game=$($versoes['game'])", "cards=$($versoes['cards'])",
            "engine=$($versoes['engine'])", "native=$($versoes['native'])")
[System.IO.File]::WriteAllLines((Join-Path $conteudo 'payload.markers'), $linhas,
                                (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path $payload) { Remove-Item $payload -Force }
# As duas: `ZipFile`/`ZipFileExtensions` vem da FileSystem, mas `ZipArchive` e
# `ZipArchiveMode` moram na System.IO.Compression. Carregar so' a primeira da'
# "Nao e' possivel localizar o tipo [System.IO.Compression.ZipArchiveMode]".
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Sem compressao nos dois zips (ja' estao comprimidos - recomprimir so' gastaria
# minutos de CPU para ganhar nada) e Optimal na semente, que e' texto.
$fs = [System.IO.File]::Create($payload)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($nome in @('game.zip', 'cards.zip', 'engine.zip', 'native.zip')) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, (Join-Path $conteudo $nome), $nome, [System.IO.Compression.CompressionLevel]::NoCompression) | Out-Null
  }
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, (Join-Path $conteudo 'payload.markers'), 'payload.markers',
    [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null

  # O caminho relativo sai do PROPRIO shell, nao de aritmetica de string.
  #
  # BUG QUE ISTO CONSERTA: antes era
  # `$arq.FullName.Substring($semente.Length)`. O `$stage` nasce de `$env:TEMP`,
  # que no Windows pode vir em nome CURTO 8.3 (`C:\Users\SUPORT~2\...`), enquanto
  # o `Get-ChildItem` devolve o nome LONGO (`C:\Users\suporteti2\...`). Os dois
  # apontam para a mesma pasta e tem TAMANHOS DIFERENTES — aqui, 2 caracteres —,
  # entao o Substring cortava no lugar errado e as entradas viravam
  # `seed/ed/store/...`. O resultado no jogador: `store/*.json` e
  # `decks/npc/*.ydk` extraidos numa pasta `ed/` que ninguem le, ou seja, tela de
  # Adversario sem deck nenhum. Nada acusava: o zip era valido e o exe abria.
  Push-Location $semente
  try {
    foreach ($arq in $arquivosSemente) {
      $rel = 'seed/' + ((Resolve-Path -Relative $arq.FullName) -replace '^\.\\', '' -replace '\\', '/')
      if ($rel -notmatch '^seed/(store|decks|package\.json)') {
        Falhar "entrada de semente com caminho inesperado: $rel"
      }
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $arq.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  }
  finally { Pop-Location }
}
finally { $zip.Dispose(); $fs.Dispose() }

Ok "payload.zip: $([math]::Round((Get-Item $payload).Length / 1MB, 1)) MB"

# --------------------------------------------------------------- 3. publish
Passo 3 'compilando o executavel (self-contained, pode demorar)'
if (Test-Path $saidaTmp) { Remove-Item $saidaTmp -Recurse -Force }

# As propriedades vao pela linha de comando de proposito: no csproj o projeto
# continua framework-dependent, que e' o que o ciclo de desenvolvimento quer.
& dotnet publish (Join-Path $root 'duel-server') `
  -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true `
  -p:EnableCompressionInSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:DebugType=none `
  -o $saidaTmp -v q --nologo
if ($LASTEXITCODE -ne 0) { Remove-Item $payload -Force; Falhar 'o dotnet publish falhou' }

# O payload ja esta dentro do exe; deixar o zip no repositorio so' confundiria
# o proximo build (e sao 20 MB de arquivo gerado).
Remove-Item $payload -Force

# --------------------------------------------------------------- 4. entrega
Passo 4 'montando dist/'
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist -Force | Out-Null }
$exeFinal = Join-Path $dist 'ClassicDuels.exe'
if (Test-Path $exeFinal) { Remove-Item $exeFinal -Force }
Copy-Item (Join-Path $saidaTmp 'duel-server.exe') $exeFinal -Force

# Se sobrou alguma DLL fora do exe, o "arquivo unico" nao e' unico - avisa em vez
# de entregar um pacote que quebra na maquina do outro.
$sobras = Get-ChildItem $saidaTmp -File | Where-Object { $_.Name -ne 'duel-server.exe' }
if ($sobras) {
  Write-Host "  !    ficaram arquivos fora do exe:" -ForegroundColor Yellow
  $sobras | ForEach-Object { Write-Host "         $($_.Name)" -ForegroundColor Yellow }
  Write-Host "       copie-os junto do ClassicDuels.exe ao compartilhar." -ForegroundColor Yellow
  $sobras | ForEach-Object { Copy-Item $_.FullName (Join-Path $dist $_.Name) -Force }
}

# A DIGITAL DA CASCA. O `publicar.exe` compara os fontes de `duel-server\host`
# com isto para saber se o exe em dist\ ficou para tras — a casca e' a unica
# parte que ainda viaja dentro do executavel, e um Release com ela velha
# entregaria uma casca antiga carregando um motor novo, em silencio.
#
# Por CONTEUDO, e nunca por data de modificacao: copiar a pasta do projeto entre
# maquinas reescreve a data de todo arquivo de uma vez, e um mtime assim
# acusaria mudanca em fonte que ninguem tocou. (A digital do cards.zip usa
# tamanho+data de proposito - la' sao 21 mil arquivos e ler 41 MB custaria mais
# que o ganho; aqui sao seis.)
$cache = Join-Path $dist '.cache'
if (-not (Test-Path $cache)) { New-Item -ItemType Directory -Path $cache -Force | Out-Null }
Set-Content -Path (Join-Path $cache 'casca.digital') `
            -Value (DigitalDaCasca $root) -Encoding ascii -NoNewline

# O QUE ESTE EXE EMBUTIU. O publish-release compara isto com as versoes dos
# pacotes que ele esta' prestes a publicar e RECUSA sair quando discordam.
#
# O exe traz uma copia do conteudo dentro dele, e o boot da instalacao usa essa
# copia como SEMENTE. Se o `pack` rodou antes do ultimo `release:build`, o exe
# publicado embute um game.zip mais velho que o game.zip do mesmo Release — e
# foi assim que o jogo entrou num laco infinito de atualizacao em 24/08/2026:
# baixava o Release, trocava o exe, o boot seguinte reinstalava a semente por
# cima e a checagem oferecia tudo de novo, para sempre.
#
# O `Payload.ExtrairPacote` hoje se recusa a rebaixar um pacote que ja' tem
# marcador em disco, entao o laco nao volta. Esta trava e' a outra metade:
# impede de PUBLICAR o descompasso, que continua sendo um exe entregando
# conteudo velho para toda instalacao nova.
Copy-Item (Join-Path $conteudo 'payload.markers') `
          (Join-Path $cache 'payload.markers') -Force

Remove-Item $stage -Recurse -Force
$tamanho = [math]::Round((Get-Item $exeFinal).Length / 1MB, 1)
Ok "dist\ClassicDuels.exe - $tamanho MB"
Write-Host "`n  Mande esse arquivo. Do outro lado: dois cliques, sem instalar nada.`n" -ForegroundColor Green
