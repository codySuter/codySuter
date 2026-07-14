# Automating the FIL step

OptiAudit generates the FIL load file but deliberately does **not** post anything to Eagle.
The last mile — opening FIL, loading the file, checking the preview — can be automated to
taste with the *Run FIL step* command in Settings (`{file}` is replaced with the CSV path).

Because every Eagle installation's screens, security and menu layout differ, no automation
script can be shipped that is guaranteed correct for your system. Record/write it **on the
Eagle workstation that will run it**, and keep the final "post/commit" action manual.

## Option 1 — Eagle Browser macro

Eagle Browser includes a macro/shortcut facility that can replay a recorded sequence
(open FIL, set options, load a file). Record your usual FIL run once, then point the
Run FIL step command at whatever launches that macro on your workstation. If your macro
can't take the file path as a parameter, record it to open the folder where you always save
OptiAudit files and pick the newest file manually.

## Option 2 — AutoHotkey (v2) skeleton

Install AutoHotkey on the workstation, save something like this as `run-fil.ahk`, and set
the command to `"C:\Program Files\AutoHotkey\v2\AutoHotkey.exe" C:\StoreTools\run-fil.ahk {file}`:

```ahk
; run-fil.ahk — focus Eagle Browser, open FIL, and put the file path on the clipboard.
; Adjust window titles/keystrokes to YOUR Eagle installation before trusting it.
filPath := A_Args.Has(1) ? A_Args[1] : ""
if (filPath = "") {
    MsgBox "No file path was passed in."
    ExitApp
}
A_Clipboard := filPath            ; path is ready to paste into FIL's file prompt
if WinExist("ahk_exe EagleBrowser.exe") {
    WinActivate
} else {
    MsgBox "Eagle Browser is not running."
    ExitApp
}
; From here, replay YOUR recorded keystrokes to open FIL and its load-from-file
; dialog, then paste the path with ^v. Leave the final post/commit step manual.
MsgBox "FIL file path copied to clipboard:`n" filPath
```

Start with just the clipboard behavior (safe), then add keystrokes gradually once each step
is verified against your Eagle screens.

## Option 3 — plain batch file

```bat
@echo off
rem run-fil.cmd — opens the folder with the generated file selected,
rem and copies the path to the clipboard for pasting into FIL.
echo %1 | clip
explorer /select,%1
```

## Whichever option you use

- Always compare FIL's preview counts against the OptiAudit summary
  (`N SKUs, M fields cleared`) before posting.
- Keep the generated `_audit.txt` files — they are your record of exactly what was cleared
  and what the values were beforehand.
