# Atalho do Classic Duels na area de trabalho.
#
#   npm run atalho
#
# O jogo compilado mora em dist\ClassicDuels.exe, que e' artefato de build e nao
# lugar de procurar para jogar. Este script poe um atalho na area de trabalho
# apontando para la'.
#
# Existe como SCRIPT, e nao como um .lnk commitado, por dois motivos: um atalho
# guarda caminho ABSOLUTO (o .lnk desta maquina nao serviria em outra) e a area
# de trabalho pode estar redirecionada para o OneDrive — quem sabe onde ela fica
# de verdade e' o Windows, via GetFolderPath.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Ok($m)   { Write-Host "  OK   $m" -ForegroundColor Green }
function Erro($m) { Write-Host "  ERRO $m" -ForegroundColor Red; exit 1 }

Write-Host "`n  ####  ATALHO DO CLASSIC DUELS  ####`n"

$exe = Join-Path $root 'dist\ClassicDuels.exe'
if (-not (Test-Path $exe)) {
  Erro "nao achei $exe`n       rode:  npm run pack"
}

# GetFolderPath e nao "$env:USERPROFILE\Desktop": com o OneDrive ligado a area de
# trabalho real fica em OneDrive\Area de Trabalho, e o atalho iria para uma pasta
# que ninguem ve.
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Classic Duels.lnk'

$ws = New-Object -ComObject WScript.Shell
$atalho = $ws.CreateShortcut($lnk)
$atalho.TargetPath = $exe
# O jogo escreve o log (logs\duel-server.log) ao lado de si mesmo: sem fixar o
# diretorio de trabalho, ele nasce onde o Windows resolver.
$atalho.WorkingDirectory = Split-Path -Parent $exe
$atalho.Description = 'Classic Duels'
# O icone sai de assets\icone.ico, e nao de dentro do exe. Os dois tem o mesmo
# desenho; o que muda e' o CACHE. O Windows guarda icone por caminho, e o exe
# fica sempre no mesmo lugar — trocar a arte deixava a area de trabalho
# mostrando a anterior ate' alguem limpar o cache na mao.
$ico = Join-Path $root 'assets\icone.ico'
$atalho.IconLocation = if (Test-Path $ico) { "$ico,0" } else { "$exe,0" }
$atalho.Save()

Ok "atalho criado: $lnk"
Ok "aponta para:   $exe"

# E a limpeza do cache, que e' o outro lado do mesmo problema: sem isto, o
# icone trocado so' aparece quando o Windows resolver.
& ie4uinit.exe -ClearIconCache 2>$null
& ie4uinit.exe -show 2>$null
Ok "cache de icones do Windows limpo"
Write-Host "`n  Se AINDA aparecer o icone antigo, so' o Explorer segura o cache:"
Write-Host "  reinicie o explorer.exe (Gerenciador de Tarefas > Explorer > Reiniciar).`n"
