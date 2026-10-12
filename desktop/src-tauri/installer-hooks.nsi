; Installer hooks for the NSIS package.

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The program keeps its projects, generations and settings beside the executable, and the template's
  ; "delete application data" only knows about the profile. When it is ticked, the listed data folders go
  ; too. Only these folders are removed, never $INSTDIR recursively: the program may have been installed
  ; into a shared folder or a drive root.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\data"
    RMDir /r "$INSTDIR\secrets"
    RMDir /r "$INSTDIR\webview-data"
    RMDir /r "$INSTDIR\temp"
  ${EndIf}

  ; Empty-only: an unticked uninstall leaves the projects alone, and the folder itself disappears once
  ; nothing is left in it.
  RMDir "$INSTDIR"
!macroend
