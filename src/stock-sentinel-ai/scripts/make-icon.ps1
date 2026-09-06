# gen
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\assets'
if (!(Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }

$upColor   = [System.Drawing.Color]::FromArgb(240, 76, 76)    # --up   #f04c4c
$downColor = [System.Drawing.Color]::FromArgb(0, 160, 110)    # --down #00a06e
$accent    = [System.Drawing.Color]::FromArgb(76, 154, 255)   # --accent #4c9aff

function New-RoundedPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $r * 2, $r * 2, 180, 90)
  $p.AddArc($x + $w - $r * 2, $y, $r * 2, $r * 2, 270, 90)
  $p.AddArc($x + $w - $r * 2, $y + $h - $r * 2, $r * 2, $r * 2, 0, 90)
  $p.AddArc($x, $y + $h - $r * 2, $r * 2, $r * 2, 90, 90)
  $p.CloseFigure()
  return $p
}

function Get-IconPng([int]$size, [float]$scale) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # tile: rounded square
  $pad = 32 * $scale
  $tile = New-RoundedPath ([int]$pad) ([int]$pad) ([int]($size - 2 * $pad)) ([int]($size - 2 * $pad)) ([int](96 * $scale))
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, $size)),
    [System.Drawing.Color]::FromArgb(27, 36, 50),
    [System.Drawing.Color]::FromArgb(14, 17, 24))
  $g.FillPath($bg, $tile)

  # subtle grid
  $gridPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(30, 255, 255, 255), [single](1 * $scale))
  $gridSet = @(0.25, 0.5, 0.75)
  foreach ($f in $gridSet) {
    $y = [int]($size * $f)
    $g.DrawLine($gridPen, [int]($pad * 1.1), $y, [int]($size - $pad * 1.1), $y)
  }
  $gridPen.Dispose()

  # candles: x/y centers scaled, height ascending trend
  # region from pad..size-pad
  $cx0 = [int]($size * 0.30)
  $cx1 = [int]($size * 0.70)
  $cyBase = [int]($size * 0.74)
  $cw = [single](26 * $scale)
  $gap = [single](($cx1 - $cx0) / 4.0)
  $data = @(
    @{kind='down'; body= 70; top= 0.0},
    @{kind='up';   body= 96; top= 0.0},
    @{kind='down'; body= 70; top= 0.0},
    @{kind='up';   body= 120; top= 0.0},
    @{kind='up';   body= 170; top= 0.0}
  )

  $candlePen = $null
  for ($i = 0; $i -lt $data.Count; $i++) {
    $cx = [int]($cx0 + $i * $gap)
    $c = $data[$i]
    $bodyH = [int]($c.body * $scale)
    $bodyTop = $cyBase - $bodyH
    $wickH = [int]((14 + $c.body * 0.18) * $scale)
    $isUp = $c.kind -eq 'up'
    $col = if ($isUp) { $upColor } else { $downColor }

    # wick
    if ($candlePen -eq $null) {
      $candlePen = New-Object System.Drawing.Pen ($col, [single](3 * $scale))
      $candlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $candlePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    } else {
      $candlePen.Color = $col
      $candlePen.Width = [single](3 * $scale)
    }
    $g.DrawLine($candlePen, $cx, $bodyTop - $wickH, $cx, $bodyTop + $bodyH + $wickH)

    # body
    $brush = New-Object System.Drawing.SolidBrush ($col)
    $rx = [int]($cx - $cw / 2)
    $g.FillRectangle($brush, $rx, $bodyTop, [int]$cw, $bodyH)
    $brush.Dispose()
  }
  if ($candlePen -ne $null) { $candlePen.Dispose() }

  # ascending accent arrow (insight)
  $pen = New-Object System.Drawing.Pen ($accent, [single](5 * $scale))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $p0 = [System.Drawing.Point]::new([int]($size * 0.24), [int]($size * 0.34))
  $p1 = [System.Drawing.Point]::new([int]($size * 0.76), [int]($size * 0.16))
  $g.DrawLine($pen, $p0, $p1)
  # arrow head
  $ah = [int](22 * $scale)
  $hx1 = [int]($p1.X - $ah)
  $hy1 = [int]($p1.Y + $ah * 0.7)
  $hx2 = [int]($p1.X - $ah * 0.7)
  $hy2 = [int]($p1.Y + $ah)
  $headPts = @(
    [System.Drawing.Point]::new($p1.X, $p1.Y),
    [System.Drawing.Point]::new($hx1, $hy1),
    [System.Drawing.Point]::new($hx2, $hy2)
  )
  $g.FillPolygon((New-Object System.Drawing.SolidBrush ($accent)), $headPts)
  $pen.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bytes = $ms.ToArray()
  $ms.Dispose()
  $bmp.Dispose()
  return $bytes
}

$png = Join-Path $out 'icon.png'
[System.IO.File]::WriteAllBytes($png, (Get-IconPng 512 1.0))
Write-Host "wrote $png"

# pack multi-size ICO (PNG-in-ICO, Vista+)
$sizes = @(16, 32, 48, 64, 128, 256)
$frames = @()
foreach ($s in $sizes) { $frames += ,(Get-IconPng $s ($s / 512.0)) }

$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter ($ico)
$count = $sizes.Count
$bw.Write([uint16]0)           # reserved
$bw.Write([uint16]1)           # type = icon
$bw.Write([uint16]$count)      # count

$offset = 6 + 16 * $count
for ($i = 0; $i -lt $count; $i++) {
  $s = $sizes[$i]
  $b = $frames[$i]
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s })) # width
  $bw.Write([byte]$(if ($s -ge 256) { 0 } else { $s })) # height
  $bw.Write([byte]0)   # color count
  $bw.Write([byte]0)   # reserved
  $bw.Write([uint16]1) # planes
  $bw.Write([uint16]32)# bit count
  $bw.Write([uint32]$b.Length) # bytes in res
  $bw.Write([uint32]$offset)   # image offset
  $offset += $b.Length
}
foreach ($b in $frames) { $bw.Write($b) }
$bw.Flush()
$icoBytes = $ico.ToArray()
$bw.Dispose(); $ico.Dispose()

$icoPath = Join-Path $out 'icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $icoBytes)
Write-Host "wrote $icoPath ($($icoBytes.Length) bytes, $count frames)"
