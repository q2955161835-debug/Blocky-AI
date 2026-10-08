Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "build-settings.nsh"
Var PayloadStarted
Var ManifestStarted
Var UninstallerStarted
Var DesktopShortcutStarted
Var AppShortcutStarted
Var UninstallShortcutStarted
Var ShortcutDirectoryStarted
Var RegistryStarted
!macro CLEANUP_FAILED_INSTALL
  ${If} $RegistryStarted == 1
    DeleteRegKey HKCU "${BETA_UNINSTALL_KEY}"
  ${EndIf}
  ${If} $DesktopShortcutStarted == 1
    Delete "$DESKTOP\Blocky Studio（测试版）.lnk"
  ${EndIf}
  ${If} $AppShortcutStarted == 1
    Delete "$SMPROGRAMS\Blocky Studio（测试版）\Blocky Studio（测试版）.lnk"
  ${EndIf}
  ${If} $UninstallShortcutStarted == 1
    Delete "$SMPROGRAMS\Blocky Studio（测试版）\卸载测试版.lnk"
  ${EndIf}
  ${If} $ShortcutDirectoryStarted == 1
    RMDir "$SMPROGRAMS\Blocky Studio（测试版）"
  ${EndIf}
  ${If} $ManifestStarted == 1
    Delete "$INSTDIR\installer-manifest.json"
  ${EndIf}
  ${If} $UninstallerStarted == 1
    Delete "$INSTDIR\Uninstall.exe"
  ${EndIf}
  ${If} $PayloadStarted == 1
    !insertmacro UNINSTALL_PACKAGE_FILES
    !insertmacro REMOVE_EMPTY_PACKAGE_DIRECTORIES
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
!include "install-safety.nsh"
Name "${BETA_DISPLAY_NAME}"
OutFile "${INSTALLER_OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Blocky Studio Beta"
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${FILE_VERSION}"
VIAddVersionKey /LANG=2052 "ProductName" "${BETA_DISPLAY_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "Blocky Studio 每用户测试版安装器"
VIAddVersionKey /LANG=2052 "FileVersion" "${RELEASE_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${RELEASE_VERSION}"
!define MUI_ICON "${BETA_ICON}"
!define MUI_UNICON "${BETA_ICON}"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckInstallDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "此测试版需要 Windows x64。安装未开始。" /SD IDOK
    SetErrorLevel 3
    Quit
  ${EndIf}
  SetRegView 64
  ReadRegStr $0 HKCU "${BETA_UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 != ""
    MessageBox MB_OK|MB_ICONSTOP "检测到已有 Blocky Studio 测试版，请先从 Windows 应用和功能卸载旧测试版，再重新安装。作品和配置不会被卸载程序删除。" /SD IDOK
    SetErrorLevel 4
    Quit
  ${EndIf}
  SetRegView 32
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $1 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ${If} $1 == ""
    ${OrIf} $1 == "0.0.0.0"
      MessageBox MB_OK|MB_ICONSTOP "缺少 Microsoft Edge WebView2 Runtime。请从 https://developer.microsoft.com/microsoft-edge/webview2/ 下载 Evergreen Standalone Installer（x64），运行后重试本安装器。仅安装 Edge 浏览器不能替代该运行库；本安装器不会下载或静默安装依赖。" /SD IDOK
      SetErrorLevel 5
      Quit
    ${EndIf}
  ${EndIf}
  SetRegView 64
  !insertmacro CHECK_VC_DEPENDENCIES
FunctionEnd

Section "安装测试版"
  Call CheckInstallDirectory
  SetShellVarContext current
  SetRegView 64
  SetOverwrite off
  StrCpy $PayloadStarted 1
  !insertmacro INSTALL_PACKAGE_FILES
  ClearErrors
  SetOutPath "$INSTDIR"
  !insertmacro CHECK_INSTALL_WRITE
  StrCpy $ManifestStarted 1
  ClearErrors
  File /oname=installer-manifest.json "${INSTALLER_MANIFEST}"
  !insertmacro CHECK_INSTALL_WRITE
  StrCpy $UninstallerStarted 1
  ClearErrors
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  !insertmacro CHECK_INSTALL_WRITE
  StrCpy $ShortcutDirectoryStarted 1
  ClearErrors
  CreateDirectory "$SMPROGRAMS\Blocky Studio（测试版）"
  !insertmacro CHECK_INSTALL_WRITE
  IfFileExists "$SMPROGRAMS\Blocky Studio（测试版）\Blocky Studio（测试版）.lnk" 0 +2
  Call InstallationFailed
  StrCpy $AppShortcutStarted 1
  ClearErrors
  CreateShortcut "$SMPROGRAMS\Blocky Studio（测试版）\Blocky Studio（测试版）.lnk" "$INSTDIR\Blocky Studio.exe" "" "$INSTDIR\Blocky Studio.exe"
  !insertmacro CHECK_INSTALL_WRITE
  IfFileExists "$SMPROGRAMS\Blocky Studio（测试版）\卸载测试版.lnk" 0 +2
  Call InstallationFailed
  StrCpy $UninstallShortcutStarted 1
  ClearErrors
  CreateShortcut "$SMPROGRAMS\Blocky Studio（测试版）\卸载测试版.lnk" "$INSTDIR\Uninstall.exe"
  !insertmacro CHECK_INSTALL_WRITE
  IfFileExists "$DESKTOP\Blocky Studio（测试版）.lnk" 0 +2
  Call InstallationFailed
  StrCpy $DesktopShortcutStarted 1
  ClearErrors
  CreateShortcut "$DESKTOP\Blocky Studio（测试版）.lnk" "$INSTDIR\Blocky Studio.exe" "" "$INSTDIR\Blocky Studio.exe"
  !insertmacro CHECK_INSTALL_WRITE
  StrCpy $RegistryStarted 1
  ClearErrors
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "DisplayVersion" "${RELEASE_VERSION}"
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "Publisher" "Blocky"
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Blocky Studio.exe"
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  WriteRegDWORD HKCU "${BETA_UNINSTALL_KEY}" "NoModify" 1
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  WriteRegDWORD HKCU "${BETA_UNINSTALL_KEY}" "NoRepair" 1
  !insertmacro CHECK_INSTALL_WRITE
  ClearErrors
  WriteRegDWORD HKCU "${BETA_UNINSTALL_KEY}" "EstimatedSize" ${INSTALLED_KIB}
  !insertmacro CHECK_INSTALL_WRITE
  ; Publish the visible uninstall entry only after all its metadata was written.
  ClearErrors
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "DisplayName" "${BETA_DISPLAY_NAME}"
  !insertmacro CHECK_INSTALL_WRITE
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  ReadRegStr $0 HKCU "${BETA_UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 != $INSTDIR
    MessageBox MB_OK|MB_ICONSTOP "测试版安装记录与卸载位置不一致，未删除任何文件。" /SD IDOK
    SetErrorLevel 8
    Quit
  ${EndIf}
  !insertmacro UNINSTALL_PACKAGE_FILES
  Delete "$INSTDIR\installer-manifest.json"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$DESKTOP\Blocky Studio（测试版）.lnk"
  Delete "$SMPROGRAMS\Blocky Studio（测试版）\Blocky Studio（测试版）.lnk"
  Delete "$SMPROGRAMS\Blocky Studio（测试版）\卸载测试版.lnk"
  RMDir "$SMPROGRAMS\Blocky Studio（测试版）"
  !insertmacro REMOVE_EMPTY_PACKAGE_DIRECTORIES
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${BETA_UNINSTALL_KEY}"
SectionEnd
