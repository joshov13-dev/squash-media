; Windows Explorer integration for the SquashForge installer.
; Adds "Compress with SquashForge" to the right-click menu of photos, videos
; and folders, and puts SquashForge in the "Send to" menu. On Windows 11 the
; right-click entry sits under "Show more options".

!macro SquashForgeVerbAdd EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\SquashForge" "" "Compress with SquashForge"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\SquashForge" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\SquashForge\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro SquashForgeVerbRemove EXT
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\SquashForge"
!macroend

; Every extension SquashForge opens, apart from ".ts" (TypeScript shares it).
!macro SquashForgeEachExtension MACRO
  !insertmacro ${MACRO} ".jpg"
  !insertmacro ${MACRO} ".jpeg"
  !insertmacro ${MACRO} ".jfif"
  !insertmacro ${MACRO} ".png"
  !insertmacro ${MACRO} ".webp"
  !insertmacro ${MACRO} ".avif"
  !insertmacro ${MACRO} ".tif"
  !insertmacro ${MACRO} ".tiff"
  !insertmacro ${MACRO} ".bmp"
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
  !insertmacro SquashForgeEachExtension SquashForgeVerbAdd
  WriteRegStr SHCTX "Software\Classes\Directory\shell\SquashForge" "" "Compress with SquashForge"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\SquashForge" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\Directory\shell\SquashForge\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  CreateShortCut "$SENDTO\SquashForge.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!macroend

!macro customUnInstall
  !insertmacro SquashForgeEachExtension SquashForgeVerbRemove
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\SquashForge"
  Delete "$SENDTO\SquashForge.lnk"
!macroend
