# Export the editable SVG paths as Chrome-compatible PNGs without dependencies.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path $PSScriptRoot '../assets'
[xml]$source = Get-Content -LiteralPath (Join-Path $assetDirectory 'icon.svg') -Raw
foreach ($size in @(16, 32, 48, 128)) {
    $scale = 4
    $canvas = [System.Drawing.Bitmap]::new($size * $scale, $size * $scale)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size * $scale / 128.0, $size * $scale / 128.0)
    $tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $rect = $source.svg.rect
    $x = [single]$rect.x; $y = [single]$rect.y
    $width = [single]$rect.width; $height = [single]$rect.height; $diameter = 2 * [single]$rect.rx
    $tile.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $tile.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $tile.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $tile.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $tile.CloseFigure()
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($rect.fill))
    $graphics.FillPath($brush, $tile)
    $brush.Dispose(); $tile.Dispose()
    foreach ($shape in $source.svg.path) {
        $tokens = [regex]::Matches($shape.d, '[MCZ]|-?\d+(?:\.\d+)?')
        $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
        $position = 0; $pointX = 0; $pointY = 0
        while ($position -lt $tokens.Count) {
            $command = $tokens[$position++].Value
            switch ($command) {
                'M' { $pointX = [single]$tokens[$position++].Value; $pointY = [single]$tokens[$position++].Value }
                'C' {
                    $a = [single]$tokens[$position++].Value; $b = [single]$tokens[$position++].Value
                    $c = [single]$tokens[$position++].Value; $d = [single]$tokens[$position++].Value
                    $endX = [single]$tokens[$position++].Value; $endY = [single]$tokens[$position++].Value
                    $path.AddBezier($pointX, $pointY, $a, $b, $c, $d, $endX, $endY)
                    $pointX = $endX; $pointY = $endY
                }
                'Z' { $path.CloseFigure() }
                default { throw "Unsupported SVG path command: $command" }
            }
        }
        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($shape.fill))
        $graphics.FillPath($brush, $path)
        $brush.Dispose(); $path.Dispose()
    }
    $graphics.Dispose()
    $output = [System.Drawing.Bitmap]::new($size, $size)
    $resize = [System.Drawing.Graphics]::FromImage($output)
    $resize.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resize.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $resize.DrawImage($canvas, 0, 0, $size, $size)
    $output.Save((Join-Path $assetDirectory "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $resize.Dispose(); $output.Dispose(); $canvas.Dispose()
}
Write-Output 'Created extension icons: 16, 32, 48, and 128 px.'
