; Windows Explorer integration for the SquashMedia installer.
; Adds "Compress with SquashMedia" to the right-click menu of photos, videos
; and folders, and puts SquashMedia in the "Send to" menu. On Windows 11 the
; right-click entry sits under "Show more options".

!macro SquashMediaVerbAdd EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\SquashMedia" "" "Compress with SquashMedia"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\SquashMedia" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\SquashMedia\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro SquashMediaVerbRemove EXT
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\SquashMedia"
!macroend

; Every extension SquashMedia opens, apart from ".ts" (TypeScript shares it).
!macro SquashMediaEachExtension MACRO
  !insertmacro ${MACRO} ".jpg"
  !insertmacro ${MACRO} ".jpeg"
  !insertmacro ${MACRO} ".jfif"
  !insertmacro ${MACRO} ".png"
  !insertmacro ${MACRO} ".webp"
  !insertmacro ${MACRO} ".avif"
  !insertmacro ${MACRO} ".tif"
  !insertmacro ${MACRO} ".tiff"
  !insertmacro ${MACRO} ".bmp"
  !insertmacro ${MACRO} ".heic"
  !insertmacro ${MACRO} ".heif"
  !insertmacro ${MACRO} ".mp4"
  !insertmacro ${MACRO} ".m4v"
  !insertmacro ${MACRO} ".mov"
  !insertmacro ${MACRO} ".mkv"
  !insertmacro ${MACRO} ".webm"
  !insertmacro ${MACRO} ".avi"
  !insertmacro ${MACRO} ".wmv"
  !insertmacro ${MACRO} ".flv"
  !insertmacro ${MACRO} ".mts"
  !insertmacro ${MACRO} ".m2ts"
  !insertmacro ${MACRO} ".mpg"
  !insertmacro ${MACRO} ".mpeg"
  !insertmacro ${MACRO} ".3gp"
  !insertmacro ${MACRO} ".ogv"
!macroend

!macro customInstall
  !insertmacro SquashMediaEachExtension SquashMediaVerbAdd
  WriteRegStr SHCTX "Software\Classes\Directory\shell\SquashMedia" "" "Compress with SquashMedia"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\SquashMedia" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\Directory\shell\SquashMedia\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  CreateShortCut "$SENDTO\SquashMedia.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!macroend

!macro customUnInstall
  !insertmacro SquashMediaEachExtension SquashMediaVerbRemove
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\SquashMedia"
  Delete "$SENDTO\SquashMedia.lnk"
  ; The "squashmedia" command, if it was installed from Settings. Updates run
  ; the old uninstaller too, so leave it alone then.
  ${IfNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\SquashMedia\bin"
    nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d=[Environment]::GetFolderPath('LocalApplicationData')+'\SquashMedia\bin'; $$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$$true); $$p=[string]$$k.GetValue('Path','','DoNotExpandEnvironmentNames'); $$n=(@($$p -split ';' | Where-Object { $$_ -and ($$_.TrimEnd('\') -ne $$d) }) -join ';'); if ($$n -ne $$p) { $$k.SetValue('Path',$$n,'ExpandString') }"`
  ${EndIf}
!macroend
