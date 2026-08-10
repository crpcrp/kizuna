; Kizuna's old releases allowed users to put UniDic below the installation
; directory. NSIS removes that directory before installing an upgrade, so copy
; the legacy payload into Electron's persistent user-data directory first.
;
; The APPDATA value is captured before electron-builder switches the shell
; context for a per-machine install. Electron runs as the original user and
; therefore uses this user's roaming APPDATA for app.getPath('userData').

!macro preInit
  !ifndef BUILD_UNINSTALLER
    ReadEnvStr $R8 "APPDATA"
  !endif
!macroend

!macro customInit
  StrCpy $R9 "$R8\${PRODUCT_NAME}\mecab\unidic"

  ; A legacy UniDic is identified by its compiled sys.dic. An existing target
  ; directory is never replaced, including a target left by a prior failed
  ; migration; the application will fall back to IPADIC if it is invalid.
  IfFileExists "$INSTDIR\resources\mecab\unidic\sys.dic" 0 kizuna_unidic_migration_done
  IfFileExists "$R9\." kizuna_unidic_migration_done

  StrCpy $R7 "$R9.migration-tmp"
  RMDir /r "$R7"
  CreateDirectory "$R8\${PRODUCT_FILENAME}\mecab"
  CreateDirectory "$R7"
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\resources\mecab\unidic\*.*" "$R7"
  IfErrors kizuna_unidic_migration_failed

  ClearErrors
  Rename "$R7" "$R9"
  IfErrors kizuna_unidic_migration_failed
  Goto kizuna_unidic_migration_done

kizuna_unidic_migration_failed:
  DetailPrint "Kizuna could not preserve the legacy UniDic folder; IPADIC remains available."
  RMDir /r "$R7"

kizuna_unidic_migration_done:
!macroend
