# Non-intrusive version of snap.ps1: captures the Off Player window with
# PrintWindow (no focus change) and delivers clicks/keys as window messages to
# the WebView, so the real mouse cursor and the foreground app are untouched.
# Coordinates are window-relative, matching the saved screenshot.
param(
  [Parameter(Mandatory)] [string]$Out,
  [int]$ClickX = -1,
  [int]$ClickY = -1,
  [string]$Key = "",          # virtual-key name: Escape, Space, Right, Left, I, F ...
  [int]$Wheel = 0,            # mouse-wheel notches at ClickX/ClickY (or window centre); negative scrolls down
  [string]$Text = "",         # typed into the focused field (after any click)
  [switch]$Hover,             # with ClickX/ClickY: only move the pointer there, don't click
  [int]$DelayMs = 600
)
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class PW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public static List<IntPtr> Find(IntPtr parent, string cls) {
    var found = new List<IntPtr>();
    EnumChildWindows(parent, (h, l) => {
      var sb = new StringBuilder(256); GetClassName(h, sb, 256);
      if (sb.ToString() == cls) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[PW]::SetProcessDPIAware() | Out-Null
$p = Get-Process -Name off-player -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$h = $p.MainWindowHandle
$r = New-Object PW+RECT
[PW]::GetWindowRect($h, [ref]$r) | Out-Null

$target = [PW]::Find($h, "Chrome_RenderWidgetHostHWND") | Select-Object -First 1
if (-not $target) { $target = [PW]::Find($h, "Chrome_WidgetWin_0") | Select-Object -First 1 }
if (-not $target) { throw "WebView window not found" }

if ($Wheel -ne 0) {
  $sx = $r.L + $(if ($ClickX -ge 0) { $ClickX } else { [int](($r.R - $r.L) / 2) })
  $sy = $r.T + $(if ($ClickY -ge 0) { $ClickY } else { [int](($r.B - $r.T) / 2) })
  $lp = [IntPtr](($sy -shl 16) -bor ($sx -band 0xFFFF))   # WM_MOUSEWHEEL takes screen coords
  $step = if ($Wheel -lt 0) { -120 } else { 120 }
  for ($i = 0; $i -lt [math]::Abs($Wheel); $i++) {
    $wp = [IntPtr]([int64](($step -band 0xFFFF) -shl 16))
    [PW]::PostMessage($target, 0x020A, $wp, $lp) | Out-Null
    Start-Sleep -Milliseconds 40
  }
  $ClickX = -1   # wheel only; don't also click
}
if ($ClickX -ge 0) {
  $pt = New-Object PW+POINT
  $pt.X = $r.L + $ClickX; $pt.Y = $r.T + $ClickY
  [PW]::ScreenToClient($target, [ref]$pt) | Out-Null
  $lp = [IntPtr](($pt.Y -shl 16) -bor ($pt.X -band 0xFFFF))
  # Two moves a pixel apart: Chromium treats a single move as no movement.
  $lp0 = [IntPtr]((($pt.Y - 1) -shl 16) -bor (($pt.X - 1) -band 0xFFFF))
  [PW]::PostMessage($target, 0x0200, [IntPtr]0, $lp0) | Out-Null   # WM_MOUSEMOVE
  Start-Sleep -Milliseconds 30
  [PW]::PostMessage($target, 0x0200, [IntPtr]0, $lp) | Out-Null    # WM_MOUSEMOVE
  if (-not $Hover) {
    Start-Sleep -Milliseconds 60
    [PW]::PostMessage($target, 0x0201, [IntPtr]1, $lp) | Out-Null   # WM_LBUTTONDOWN
    Start-Sleep -Milliseconds 40
    [PW]::PostMessage($target, 0x0202, [IntPtr]0, $lp) | Out-Null   # WM_LBUTTONUP
  }
}
if ($Text) {
  Start-Sleep -Milliseconds 150
  foreach ($ch in $Text.ToCharArray()) {
    [PW]::PostMessage($target, 0x0102, [IntPtr][int]$ch, [IntPtr]1) | Out-Null   # WM_CHAR
    Start-Sleep -Milliseconds 15
  }
}
if ($Key) {
  $vk = [int][System.Windows.Forms.Keys]::$Key
  [PW]::PostMessage($target, 0x0100, [IntPtr]$vk, [IntPtr]1) | Out-Null          # WM_KEYDOWN
  Start-Sleep -Milliseconds 30
  [PW]::PostMessage($target, 0x0101, [IntPtr]$vk, [IntPtr]0xC0000001) | Out-Null # WM_KEYUP
}
Start-Sleep -Milliseconds $DelayMs

$w = $r.R - $r.L; $hh = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
[PW]::PrintWindow($h, $dc, 2) | Out-Null   # PW_RENDERFULLCONTENT
$g.ReleaseHdc($dc); $g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"saved $Out ($w x $hh) target=0x{0:X}" -f [int64]$target
