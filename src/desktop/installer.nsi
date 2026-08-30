Unicode true
SetCompressor /SOLID lzma

!include "WordFunc.nsh"
!insertmacro VersionCompare

!define PRODUCT_NAME "股市脉搏"
!define PRODUCT_VERSION "0.3.8"
!define PRODUCT_EXE "StockPulse.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hangqing Desktop"
!define INSTALL_DIR_NAME "Hangqing Desktop"
!ifndef BUILD_ARCH
  !define BUILD_ARCH "x64"
!endif
!ifndef APP_SOURCE
  !define APP_SOURCE "release\win-unpacked"
!endif

!macro StopRunningApp
  nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /T /IM "${PRODUCT_EXE}"'
  Pop $0
  Pop $1
  Sleep 500
!macroend

Name "${PRODUCT_NAME}"
OutFile "release\hangqing-desktop-${PRODUCT_VERSION}-win-${BUILD_ARCH}-setup.exe"
Icon "assets\icon.ico"
UninstallIcon "assets\icon.ico"
InstallDir "$LOCALAPPDATA\Programs\${INSTALL_DIR_NAME}"
RequestExecutionLevel user
AutoCloseWindow true
ShowInstDetails show
ShowUninstDetails show

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Function .onInit
  SetShellVarContext current
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "DisplayVersion"
  StrCmp $0 "" version_check_done

  ${VersionCompare} "${PRODUCT_VERSION}" "$0" $1
  StrCmp $1 "0" version_same
  StrCmp $1 "1" version_upgrade version_downgrade

version_same:
  MessageBox MB_OK|MB_ICONINFORMATION "已安装版本 $0，与当前安装包版本相同，无需更新。" /SD IDOK
  SetErrorLevel 0
  Quit

version_upgrade:
  MessageBox MB_YESNO|MB_ICONQUESTION "检测到已安装版本 $0，当前安装包版本 ${PRODUCT_VERSION}。是否覆盖升级？" /SD IDYES IDYES version_check_done
  SetErrorLevel 0
  Quit

version_downgrade:
  MessageBox MB_OK|MB_ICONEXCLAMATION "已安装版本 $0 高于当前安装包版本 ${PRODUCT_VERSION}，不允许降级安装。" /SD IDOK
  SetErrorLevel 0
  Quit

version_check_done:
FunctionEnd

Section "Install"
  SetShellVarContext current
  !insertmacro StopRunningApp
  SetOutPath "$INSTDIR"
  File /r /x "*.exe" "${APP_SOURCE}\*.*"
  File /oname=${PRODUCT_EXE} "${APP_SOURCE}\*.exe"
  File /oname=app-icon.ico "assets\icon.ico"

  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\app-icon.ico" 0
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\app-icon.ico" 0
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\app-icon.ico" 0

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME} (${BUILD_ARCH})"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "股市脉搏"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" '"$INSTDIR\app-icon.ico",0'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  Exec '"$INSTDIR\${PRODUCT_EXE}"'
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro StopRunningApp
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  RMDir /r /REBOOTOK "$INSTDIR"
SectionEnd
