' Winampify launcher: opens the packaged Winampify.exe (made by "node build.js"),
' or the development copy if it hasn't been built yet. No console window.
Option Explicit
Dim sh, fso, dir, exe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

exe = dir & "\release\Winampify\Winampify.exe"
If fso.FileExists(exe) Then
  sh.Run """" & exe & """", 1, False
  WScript.Quit 0
End If

exe = dir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Winampify isn't installed yet." & vbCrLf & "Open a terminal in " & dir & " and run:  npm install", vbExclamation, "Winampify"
  WScript.Quit 1
End If
sh.CurrentDirectory = dir
sh.Run """" & exe & """ """ & dir & """", 1, False
