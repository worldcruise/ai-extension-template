$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assetsPath = Join-Path $projectRoot 'assets'
[IO.Directory]::CreateDirectory($assetsPath) | Out-Null

foreach ($size in @(16, 32, 48, 128)) {
    $bitmap = [Drawing.Bitmap]::new($size * 4, $size * 4)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform($size * 4 / 128, $size * 4 / 128)
    $green = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#147d66'))
    $white = [Drawing.SolidBrush]::new([Drawing.Color]::White)
    $pen = [Drawing.Pen]::new($green, 5)
    $pen.StartCap = [Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $roundRect = [Drawing.Drawing2D.GraphicsPath]::new()
    $roundRect.AddArc(0, 0, 60, 60, 180, 90)
    $roundRect.AddArc(68, 0, 60, 60, 270, 90)
    $roundRect.AddArc(68, 68, 60, 60, 0, 90)
    $roundRect.AddArc(0, 68, 60, 60, 90, 90)
    $roundRect.CloseFigure()
    $graphics.FillPath($green, $roundRect)
    $bubble = [Drawing.Drawing2D.GraphicsPath]::new()
    $bubble.AddArc(26, 31, 18, 18, 180, 90)
    $bubble.AddArc(84, 31, 18, 18, 270, 90)
    $bubble.AddArc(84, 73, 18, 18, 0, 90)
    $bubble.AddLine(93, 91, 59, 91)
    $bubble.AddLine(59, 91, 36, 106)
    $bubble.AddLine(36, 106, 36, 91)
    $bubble.AddArc(26, 73, 18, 18, 90, 90)
    $bubble.CloseFigure()
    $graphics.FillPath($white, $bubble)
    $graphics.DrawLine($pen, 78, 44, 78, 78)
    $graphics.DrawLine($pen, 42, 51, 65, 51)
    $graphics.DrawLine($pen, 42, 63, 58, 63)
    $icon = [Drawing.Bitmap]::new($size, $size)
    $outputGraphics = [Drawing.Graphics]::FromImage($icon)
    $outputGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $outputGraphics.DrawImage($bitmap, 0, 0, $size, $size)
    $icon.Save((Join-Path $assetsPath "icon-$size.png"), [Drawing.Imaging.ImageFormat]::Png)
    $outputGraphics.Dispose()
    $icon.Dispose()
    $bubble.Dispose()
    $roundRect.Dispose()
    $pen.Dispose()
    $green.Dispose()
    $white.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
Write-Output 'Generated extension icons.'
