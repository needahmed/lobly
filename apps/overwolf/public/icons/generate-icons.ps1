$targetDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopAssets = Resolve-Path (Join-Path $targetDir "../../../desktop/assets")

# Keep one drawing implementation and vector source for both desktop hosts.
. (Join-Path $desktopAssets "generate-icons.ps1")
Copy-Item (Join-Path $desktopAssets "lobly-mark.svg") (Join-Path $targetDir "lobly-mark.svg") -Force

$brand = New-LoblyBitmap
$brand.Save((Join-Path $targetDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$brand.Save((Join-Path $targetDir "window_icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)

$gray = New-LoblyBitmap -Muted
$gray.Save((Join-Path $targetDir "icon_gray.png"), [System.Drawing.Imaging.ImageFormat]::Png)

$icon = [System.Drawing.Icon]::FromHandle($brand.GetHicon())
$stream = [System.IO.File]::Create((Join-Path $targetDir "launcher.ico"))
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
Copy-Item (Join-Path $targetDir "launcher.ico") (Join-Path $targetDir "tray.ico") -Force

$gray.Dispose()
$brand.Dispose()
Write-Host "LOBLY Overwolf icons written to $targetDir"
