param(
  [Parameter(Mandatory=$true)][string]$TargetPath
)
# VECTRA — Windows 桌面快捷方式创建 (.lnk)
$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop 'Vectra.lnk'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($ShortcutPath)
$sc.TargetPath = $TargetPath
$sc.WorkingDirectory = Split-Path $TargetPath
$sc.Description = 'Vectra - AI NPC Simulation'
$sc.Save()
Write-Host "Created: $ShortcutPath"
