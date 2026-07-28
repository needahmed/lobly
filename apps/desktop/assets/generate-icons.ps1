Add-Type -AssemblyName System.Drawing

function New-LoblyBitmap {
  param(
    [int]$Size = 256,
    [switch]$Muted
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $scale = $Size / 256.0

  $surface = New-Object System.Drawing.Drawing2D.GraphicsPath
  $radius = 52 * $scale
  $diameter = $radius * 2
  $bounds = New-Object System.Drawing.RectangleF (8 * $scale), (8 * $scale), (240 * $scale), (240 * $scale)
  $surface.AddArc($bounds.Left, $bounds.Top, $diameter, $diameter, 180, 90)
  $surface.AddArc($bounds.Right - $diameter, $bounds.Top, $diameter, $diameter, 270, 90)
  $surface.AddArc($bounds.Right - $diameter, $bounds.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $surface.AddArc($bounds.Left, $bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $surface.CloseFigure()

  $surfaceBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush `
    (New-Object System.Drawing.PointF (28 * $scale), (18 * $scale)), `
    (New-Object System.Drawing.PointF (226 * $scale), (238 * $scale)), `
    ([System.Drawing.Color]::FromArgb(255, 18, 28, 49)), `
    ([System.Drawing.Color]::FromArgb(255, 7, 11, 20))
  $graphics.FillPath($surfaceBrush, $surface)

  $hexPoints = @(
    (New-Object System.Drawing.PointF (128 * $scale), (29 * $scale)),
    (New-Object System.Drawing.PointF (211 * $scale), (77 * $scale)),
    (New-Object System.Drawing.PointF (211 * $scale), (179 * $scale)),
    (New-Object System.Drawing.PointF (128 * $scale), (227 * $scale)),
    (New-Object System.Drawing.PointF (45 * $scale), (179 * $scale)),
    (New-Object System.Drawing.PointF (45 * $scale), (77 * $scale))
  )
  $hexPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 34, 52, 84)), (7 * $scale)
  $hexPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawPolygon($hexPen, $hexPoints)

  $mark = New-Object System.Drawing.Drawing2D.GraphicsPath
  $mark.AddPolygon(@(
    (New-Object System.Drawing.PointF (69 * $scale), (57 * $scale)),
    (New-Object System.Drawing.PointF (100 * $scale), (57 * $scale)),
    (New-Object System.Drawing.PointF (100 * $scale), (148 * $scale)),
    (New-Object System.Drawing.PointF (169 * $scale), (148 * $scale)),
    (New-Object System.Drawing.PointF (169 * $scale), (179 * $scale)),
    (New-Object System.Drawing.PointF (69 * $scale), (179 * $scale))
  ))
  if ($Muted) {
    $markBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 138, 151, 173))
    $nodeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 205, 213, 226))
  } else {
    $markBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush `
      (New-Object System.Drawing.PointF (64 * $scale), (54 * $scale)), `
      (New-Object System.Drawing.PointF (186 * $scale), (184 * $scale)), `
      ([System.Drawing.Color]::FromArgb(255, 66, 232, 255)), `
      ([System.Drawing.Color]::FromArgb(255, 165, 110, 255))
    $nodeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 215, 248, 255))
  }
  $graphics.FillPath($markBrush, $mark)

  foreach ($node in @(@(170, 76, 16), @(170, 118, 12))) {
    $cx = $node[0] * $scale
    $cy = $node[1] * $scale
    $half = $node[2] * $scale
    $graphics.FillPolygon($nodeBrush, @(
      (New-Object System.Drawing.PointF $cx, ($cy - $half)),
      (New-Object System.Drawing.PointF ($cx + $half), $cy),
      (New-Object System.Drawing.PointF $cx, ($cy + $half)),
      (New-Object System.Drawing.PointF ($cx - $half), $cy)
    ))
  }

  $nodeBrush.Dispose()
  $markBrush.Dispose()
  $mark.Dispose()
  $hexPen.Dispose()
  $surfaceBrush.Dispose()
  $surface.Dispose()
  $graphics.Dispose()
  return $bitmap
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bitmap = New-LoblyBitmap
$bitmap.Save((Join-Path $dir "lobly.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create((Join-Path $dir "lobly.ico"))
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
$bitmap.Dispose()

Write-Host "LOBLY desktop icons written to $dir"
