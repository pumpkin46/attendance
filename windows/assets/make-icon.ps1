<#
  make-icon.ps1 - generate the Windows app icon (assets\app.ico) and a 256px PNG
  preview (assets\app-icon.png) from code, so the icon is reproducible.

  Design: rounded-square with a violet->indigo brand gradient (matches the web
  favicon #863bff), a white "person" silhouette inside face-recognition corner
  brackets, and a green check badge (attendance confirmed). Exported as a true
  multi-resolution .ico (16/24/32/48/64/128/256) with PNG-encoded frames.

  Pure System.Drawing (Windows PowerShell 5.1) - no external tools.
#>
[CmdletBinding()]
param(
    [string]$OutIco,
    [string]$OutPng
)
$ErrorActionPreference = 'Stop'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $OutIco) { $OutIco = Join-Path $here 'app.ico' }
if (-not $OutPng) { $OutPng = Join-Path $here 'app-icon.png' }
Add-Type -AssemblyName System.Drawing

function New-IconBitmap([int]$S) {
    $bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $f = $S / 256.0

    # ---- rounded-square background with a diagonal gradient ----
    $radius = [int](56 * $f)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $S, $S)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($S - $d, 0, $d, $d, 270, 90)
    $path.AddArc($S - $d, $S - $d, $d, $d, 0, 90)
    $path.AddArc(0, $S - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $c1 = [System.Drawing.Color]::FromArgb(255, 0x7C, 0x5C, 0xFF)   # soft violet
    $c2 = [System.Drawing.Color]::FromArgb(255, 0x41, 0x1A, 0xBE)   # deep indigo
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 60.0)
    $g.FillPath($brush, $path)

    # soft top highlight
    $g.SetClip($path)
    $hi = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle(0,0,$S,[int]($S*0.55))),
        [System.Drawing.Color]::FromArgb(46,255,255,255),
        [System.Drawing.Color]::FromArgb(0,255,255,255), 90.0)
    $g.FillRectangle($hi, 0, 0, $S, [int]($S*0.55))
    $g.ResetClip()

    $white = [System.Drawing.Color]::FromArgb(255,255,255,255)

    # ---- face-recognition corner brackets ----
    if ($S -ge 32) {
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(235,255,255,255), [single]([Math]::Max(2, 11*$f)))
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
        $m = 44 * $f          # margin
        $len = 42 * $f        # arm length
        $lo = $m; $hi2 = $S - $m
        # TL
        $g.DrawLine($pen, $lo, $lo+$len, $lo, $lo); $g.DrawLine($pen, $lo, $lo, $lo+$len, $lo)
        # TR
        $g.DrawLine($pen, $hi2-$len, $lo, $hi2, $lo); $g.DrawLine($pen, $hi2, $lo, $hi2, $lo+$len)
        # BL
        $g.DrawLine($pen, $lo, $hi2-$len, $lo, $hi2); $g.DrawLine($pen, $lo, $hi2, $lo+$len, $hi2)
        # BR
        $g.DrawLine($pen, $hi2-$len, $hi2, $hi2, $hi2); $g.DrawLine($pen, $hi2, $hi2-$len, $hi2, $hi2)
        $pen.Dispose()
    }

    # ---- person silhouette (head + shoulders), clipped to a flat bottom ----
    $wb = New-Object System.Drawing.SolidBrush($white)
    $headR = 38 * $f
    $headCx = 128 * $f
    $headCy = 104 * $f
    $g.FillEllipse($wb, $headCx-$headR, $headCy-$headR, $headR*2, $headR*2)

    $shClip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $shClip.AddRectangle((New-Object System.Drawing.RectangleF(0, 0, $S, [single](182*$f))))
    $g.SetClip($shClip)
    $shW = 150 * $f; $shH = 150 * $f
    $g.FillEllipse($wb, $headCx-$shW/2, (196*$f)-$shH/2, $shW, $shH)
    $g.ResetClip()

    # ---- green "checked-in" badge, bottom-right ----
    if ($S -ge 24) {
        $bR = 42 * $f
        $bcx = 192 * $f; $bcy = 192 * $f
        $ring = New-Object System.Drawing.SolidBrush($white)   # white separator ring for pop
        $g.FillEllipse($ring, $bcx-$bR-7*$f, $bcy-$bR-7*$f, ($bR+7*$f)*2, ($bR+7*$f)*2)
        $green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,0x22,0xC5,0x5E))
        $g.FillEllipse($green, $bcx-$bR, $bcy-$bR, $bR*2, $bR*2)
        $cp = New-Object System.Drawing.Pen($white, [single]([Math]::Max(2, 12*$f)))
        $cp.StartCap=[System.Drawing.Drawing2D.LineCap]::Round; $cp.EndCap=[System.Drawing.Drawing2D.LineCap]::Round
        $cp.LineJoin=[System.Drawing.Drawing2D.LineJoin]::Round
        $g.DrawLines($cp, @(
            (New-Object System.Drawing.PointF([single]($bcx-20*$f),[single]($bcy+1*$f))),
            (New-Object System.Drawing.PointF([single]($bcx-5*$f),[single]($bcy+16*$f))),
            (New-Object System.Drawing.PointF([single]($bcx+22*$f),[single]($bcy-16*$f)))
        ))
        $cp.Dispose(); $ring.Dispose(); $green.Dispose()
    }

    $g.Dispose()
    return $bmp
}

# Encode a frame as an uncompressed 32bpp BMP/DIB for an ICO entry (color image
# bottom-up + a zeroed AND mask). GDI+ and the WinForms tray icon need this for
# small sizes; PNG-in-ICO frames only render in the modern shell.
function Get-IcoBmpBytes([System.Drawing.Bitmap]$bmp) {
    $S = $bmp.Width
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([uint32]40); $bw.Write([int32]$S); $bw.Write([int32]($S*2))   # header: size,w,h(color+mask)
    $bw.Write([uint16]1);  $bw.Write([uint16]32)                            # planes, bpp
    $bw.Write([uint32]0);  $bw.Write([uint32]0)                             # BI_RGB, sizeImage
    $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    $rect = New-Object System.Drawing.Rectangle(0,0,$S,$S)
    $dat = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $buf = New-Object byte[] ($dat.Stride * $S)
    [System.Runtime.InteropServices.Marshal]::Copy($dat.Scan0, $buf, 0, $buf.Length)
    $bmp.UnlockBits($dat)
    for ($y = $S-1; $y -ge 0; $y--) { $bw.Write($buf, $y*$dat.Stride, $S*4) }   # bottom-up BGRA
    $maskRow = [int]([Math]::Floor(($S + 31)/32)) * 4
    $bw.Write((New-Object byte[] ($maskRow * $S)))                              # AND mask = 0 (alpha used)
    $bw.Flush(); return $ms.ToArray()
}

# Frames: BMP for <=128 (max compatibility), PNG for 256 (keeps the file small).
$sizes = @(16,24,32,48,64,128,256)
$frames = @{}
foreach ($s in $sizes) {
    $bmp = New-IconBitmap $s
    if ($s -ge 256) {
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $frames[$s] = $ms.ToArray(); $ms.Dispose()
        [System.IO.File]::WriteAllBytes($OutPng, $frames[$s])
    } else {
        $frames[$s] = Get-IcoBmpBytes $bmp
    }
    $bmp.Dispose()
}

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)  # ICONDIR
$offset = 6 + 16 * $sizes.Count
foreach ($s in $sizes) {
    $len = [int]$frames[$s].Length
    $bw.Write([byte]($(if ($s -ge 256) {0} else {$s})))   # width  (0 => 256)
    $bw.Write([byte]($(if ($s -ge 256) {0} else {$s})))   # height (0 => 256)
    $bw.Write([byte]0); $bw.Write([byte]0)                 # colors, reserved
    $bw.Write([uint16]1); $bw.Write([uint16]32)            # planes, bpp
    $bw.Write([uint32]$len); $bw.Write([uint32]$offset)    # size, offset
    $offset += $len
}
foreach ($s in $sizes) {
    $arr = [byte[]]$frames[$s]
    $bw.Write($arr, 0, $arr.Length)
}
$bw.Flush()
[System.IO.File]::WriteAllBytes($OutIco, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

Write-Host "Wrote $OutIco ($((Get-Item $OutIco).Length) bytes, expected $offset) and $OutPng"
