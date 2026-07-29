# Gera dist\DuelAcademy.exe - o jogo inteiro num arquivo so'.
#
# O executavel sai self-contained (o .NET vai dentro dele) e com um payload.zip
# embutido contendo web/, ygo-data/, o cards.cdb e os scripts lua. Quem recebe
# nao precisa de .NET, nem de Node, nem do repositorio: dois cliques e joga.
#
#   npm run pack
#
# Requisitos AQUI (na maquina que empacota, nao na que joga): SDK do .NET 8.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP 'duel-academy-pack'
$payload = Join-Path $root 'duel-server\payload.zip'
$dist = Join-Path $root 'dist'
$saidaTmp = Join-Path $stage 'publish'

function Passo($n, $texto) { Write-Host "`n[$n] $texto" -ForegroundColor Cyan }
function Ok($texto) { Write-Host "  OK   $texto" -ForegroundColor Green }
function Falhar($texto) { Write-Host "  ERRO $texto" -ForegroundColor Red; exit 1 }

Write-Host "`n  ####  DUEL ACADEMY - EMPACOTAR  ####" -ForegroundColor Yellow

# ---------------------------------------------------------------- 1. conteudo
Passo 1 'juntando os arquivos do jogo'

$conteudo = Join-Path $stage 'payload'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $conteudo -Force | Out-Null

# Pastas inteiras. `package.json` vai junto so' como marcador da raiz.
$pastas = @(
  @{ de = 'web';    para = 'web' },
  @{ de = 'decks';  para = 'decks' },
  @{ de = 'store';  para = 'store' },
  @{ de = 'ygo-data\src'; para = 'ygo-data\src' }
)
foreach ($p in $pastas) {
  $origem = Join-Path $root $p.de
  if (-not (Test-Path $origem)) { Falhar "nao achei $($p.de)" }
  $destino = Join-Path $conteudo $p.para
  New-Item -ItemType Directory -Path (Split-Path -Parent $destino) -Force | Out-Null
  Copy-Item $origem $destino -Recurse -Force
}
Copy-Item (Join-Path $root 'package.json') (Join-Path $conteudo 'package.json') -Force

# Do ygo-data\data so' o que o front le. O cards.json (14 MB) entra porque e' a
# janela de detalhes da carta; os scripts lua de la' NAO, porque sao os mesmos
# que ja vao em StreamingAssets - carregar duas copias so' engorda o arquivo.
$dataDestino = Join-Path $conteudo 'ygo-data\data'
New-Item -ItemType Directory -Path $dataDestino -Force | Out-Null
foreach ($f in @('cards.json', 'cards.index.json', 'archetypes.json',
                 'scripts.index.json', 'meta.json', 'constants.json')) {
  $origem = Join-Path $root "ygo-data\data\$f"
  if (-not (Test-Path $origem)) { Falhar "nao achei ygo-data\data\$f (rode npm run data:build)" }
  Copy-Item $origem (Join-Path $dataDestino $f) -Force
}

# StreamingAssets: cards.cdb + os scripts .lua. Os .meta sao lixo da Unity e
# dobrariam a contagem de arquivos sem servir para nada aqui.
$saOrigem = Join-Path $root 'duel_academy\Assets\StreamingAssets\YGODemo'
$saDestino = Join-Path $conteudo 'duel_academy\Assets\StreamingAssets\YGODemo'
if (-not (Test-Path (Join-Path $saOrigem 'cards.cdb'))) { Falhar 'nao achei o cards.cdb dos StreamingAssets' }
New-Item -ItemType Directory -Path $saDestino -Force | Out-Null
Copy-Item (Join-Path $saOrigem 'cards.cdb') (Join-Path $saDestino 'cards.cdb') -Force

$scriptOrigem = Join-Path $saOrigem 'script'
$luas = Get-ChildItem $scriptOrigem -Recurse -Filter '*.lua' -File
foreach ($lua in $luas) {
  $rel = $lua.FullName.Substring($scriptOrigem.Length).TrimStart('\')
  $alvo = Join-Path (Join-Path $saDestino 'script') $rel
  $pastaAlvo = Split-Path -Parent $alvo
  if (-not (Test-Path $pastaAlvo)) { New-Item -ItemType Directory -Path $pastaAlvo -Force | Out-Null }
  Copy-Item $lua.FullName $alvo -Force
}

$arquivos = (Get-ChildItem $conteudo -Recurse -File)
$mb = [math]::Round(($arquivos | Measure-Object Length -Sum).Sum / 1MB, 1)
Ok "$($arquivos.Count) arquivos, $mb MB ($($luas.Count) scripts lua)"

# ------------------------------------------------------------------- 2. zip
Passo 2 'compactando o payload'
if (Test-Path $payload) { Remove-Item $payload -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $conteudo, $payload, [System.IO.Compression.CompressionLevel]::Optimal, $false)
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
$exeFinal = Join-Path $dist 'DuelAcademy.exe'
if (Test-Path $exeFinal) { Remove-Item $exeFinal -Force }
Copy-Item (Join-Path $saidaTmp 'duel-server.exe') $exeFinal -Force

# Se sobrou alguma DLL fora do exe, o "arquivo unico" nao e' unico - avisa em vez
# de entregar um pacote que quebra na maquina do outro.
$sobras = Get-ChildItem $saidaTmp -File | Where-Object { $_.Name -ne 'duel-server.exe' }
if ($sobras) {
  Write-Host "  !    ficaram arquivos fora do exe:" -ForegroundColor Yellow
  $sobras | ForEach-Object { Write-Host "         $($_.Name)" -ForegroundColor Yellow }
  Write-Host "       copie-os junto do DuelAcademy.exe ao compartilhar." -ForegroundColor Yellow
  $sobras | ForEach-Object { Copy-Item $_.FullName (Join-Path $dist $_.Name) -Force }
}

Remove-Item $stage -Recurse -Force
$tamanho = [math]::Round((Get-Item $exeFinal).Length / 1MB, 1)
Ok "dist\DuelAcademy.exe - $tamanho MB"
Write-Host "`n  Mande esse arquivo. Do outro lado: dois cliques, sem instalar nada.`n" -ForegroundColor Green
