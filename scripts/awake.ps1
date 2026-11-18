# Print the system-wide execution state (no admin needed): which "keep awake"
# flags some process currently holds. 1 = system required, 2 = display required.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class PwrState {
  [DllImport("powrprof.dll")] public static extern uint CallNtPowerInformation(int level, IntPtr inBuf, uint inLen, out uint outBuf, uint outLen);
}
"@
$state = 0
$rc = [PwrState]::CallNtPowerInformation(16, [IntPtr]::Zero, 0, [ref]$state, 4)  # SystemExecutionState
"rc=$rc state=0x{0:X} system=$([bool]($state -band 1)) display=$([bool]($state -band 2))" -f $state
