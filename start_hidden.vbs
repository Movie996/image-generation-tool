' Launch Node.js server in a completely hidden window
' The process keeps running even after this script exits
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd /c node server/launcher.js", 0, False
