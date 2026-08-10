<#
.SYNOPSIS
  Fit screenshots to a store's exact required dimensions.

.DESCRIPTION
  Chrome rejects anything that is not exactly 1280x800 or 640x400, and a browser window is
  never that shape. This scales an image to fit inside the target without cropping and
  centres it on the dashboard's own background colour, so the padding reads as part of the
  console rather than as a border.

  Fit, not fill: cropping a UI screenshot to an aspect ratio silently removes controls, and
  the missing piece is always the one that explains the product.

.EXAMPLE
  ./scripts/fit-screenshot.ps1 -Path ~/Pictures/panel.png
  ./scripts/fit-screenshot.ps1 -Path shot1.png, shot2.png -Width 1366 -Height 768
#>
param(
  [Parameter(Mandatory = $true)][string[]]$Path,
  [int]$Width = 1280,
  [int]$Height = 800,
  [string]$OutDir = 'store-assets/screenshots',
  # The console's --chassis colour, so the letterboxing is invisible.
  [string]$Background = '#0D1116'
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$bg = [System.Drawing.ColorTranslator]::FromHtml($Background)

foreach ($p in $Path) {
  $resolved = Resolve-Path $p -ErrorAction Stop
  $src = [System.Drawing.Image]::FromFile($resolved)
  try {
    $scale = [Math]::Min($Width / $src.Width, $Height / $src.Height)
    $w = [int][Math]::Round($src.Width * $scale)
    $h = [int][Math]::Round($src.Height * $scale)
    $x = [int](($Width - $w) / 2)
    $y = [int](($Height - $h) / 2)

    $canvas = New-Object System.Drawing.Bitmap($Width, $Height)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $g.Clear($bg)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.DrawImage($src, $x, $y, $w, $h)
    } finally {
      $g.Dispose()
    }

    $name = [System.IO.Path]::GetFileNameWithoutExtension($resolved)
    $out = Join-Path $OutDir "$name-${Width}x${Height}.png"
    $canvas.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()

    "{0,-46} {1}x{2} -> {3}x{4}  ({5})" -f (Split-Path $out -Leaf), $src.Width, $src.Height, $Width, $Height, "$([Math]::Round($scale * 100))% scale"
  } finally {
    $src.Dispose()
  }
}
