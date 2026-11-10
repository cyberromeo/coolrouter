; Cool Router — NSIS installer customisation (picked up by electron-builder).
;
; The app runs its server as a child process: <install dir>\resources\node\node.exe.
; When the installer or uninstaller has to force-close a running app, that child can
; outlive it and keep files in the install folder locked, so the update fails halfway
; with "Error opening file for writing". Run the stock "close the running app" step,
; then stop any server process that was started from this install folder.
;
; Only node.exe processes whose executable lives inside $INSTDIR are touched — other
; Node.js programs on the machine are left alone.

; The stock check needs these, and the template only pulls them in when
; customCheckAppRunning is NOT defined.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro _CHECK_APP_RUNNING

  ; WMI (Get-CimInstance) reports the executable path of 64-bit processes even though
  ; this installer is a 32-bit program; Get-Process does not.
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'node.exe' -and $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR\', 'OrdinalIgnoreCase') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  ; Give Windows a moment to release the file handles.
  Sleep 500
!macroend
