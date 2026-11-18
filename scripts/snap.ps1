param(
  [string]$Out,
  [string]$Keys = "",
  [int]$DelayMs = 800,
  [int]$MouseX = -1,
  [int]$MouseY = -1,
  [switch]$Click
)
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[W]::SetProcessDPIAware() | Out-Null
$p = Get-Process -Name off-player -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$h = $p.MainWindowHandle
[W]::ShowWindow($h, 9) | Out-Null
[W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 300
$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
if ($MouseX -ge 0) { [W]::SetCursorPos($r.L + $MouseX, $r.T + $MouseY) | Out-Null }
if ($Click) { Start-Sleep -Milliseconds 150; [W]::mouse_event(2,0,0,0,0); [W]::mouse_event(4,0,0,0,0) }
if ($Keys) { [System.Windows.Forms.SendKeys]::SendWait($Keys) }
Start-Sleep -Milliseconds $DelayMs
$w = $r.R - $r.L; $hgt = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"saved $Out ($w x $hgt)"
