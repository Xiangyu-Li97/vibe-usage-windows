; Retry only the known bundled runtime after normal Tauri uninstall. Never
; kill processes by filename or recursively delete user configuration/data.
!macro NSIS_HOOK_POSTUNINSTALL
  Push $0
  StrCpy $0 30
  vibe_node_delete_retry:
    IfFileExists "$INSTDIR\node\node.exe" 0 vibe_node_delete_done
    ClearErrors
    Delete "$INSTDIR\node\node.exe"
    IfErrors 0 vibe_node_delete_done
    Sleep 100
    IntOp $0 $0 - 1
    IntCmp $0 0 vibe_node_delete_deferred vibe_node_delete_deferred vibe_node_delete_retry
  vibe_node_delete_deferred:
    ; Windows can still hold an executable briefly (e.g. an AV scan). Record
    ; reboot-required cleanup instead of silently abandoning the runtime.
    Delete /REBOOTOK "$INSTDIR\node\node.exe"
    SetRebootFlag true
    SetErrorLevel 3010
  vibe_node_delete_done:
    RMDir /REBOOTOK "$INSTDIR\node"
    ; Only remove empty packaged directories left by a transient cwd lock.
    RMDir "$INSTDIR\cli\src\quotas\providers"
    RMDir "$INSTDIR\cli\src\quotas"
    RMDir "$INSTDIR\cli\src\parsers"
    RMDir "$INSTDIR\cli\src"
    RMDir "$INSTDIR\cli\bin"
    RMDir "$INSTDIR\cli"
    RMDir /REBOOTOK "$INSTDIR"
  Pop $0
!macroend
