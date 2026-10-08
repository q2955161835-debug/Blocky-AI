Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "build-settings.nsh"
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

Function CheckInstallDirectory
  StrCmp $INSTDIR "" invalid_directory
  ClearErrors
  FindFirst $0 $1 "$INSTDIR\*.*"
  IfErrors empty_directory
  directory_loop:
    StrCmp $1 "." directory_next
    StrCmp $1 ".." directory_next
    StrCmp $1 "" directory_done
    FindClose $0
    Goto invalid_directory
  directory_next:
    FindNext $0 $1
    IfErrors directory_done directory_loop
  directory_done:
    FindClose $0
  empty_directory:
    Return
  invalid_directory:
    MessageBox MB_OK|MB_ICONSTOP "请选择新的空目录。测试版安装不会覆盖已有文件、作品或其他版本。" /SD IDOK
    SetErrorLevel 7
    Quit
FunctionEnd

Section "安装测试版"
  Call CheckInstallDirectory
  SetShellVarContext current
  SetRegView 64
  SetOverwrite off
  !insertmacro INSTALL_PACKAGE_FILES
  SetOutPath "$INSTDIR"
  File /oname=installer-manifest.json "${INSTALLER_MANIFEST}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Blocky Studio（测试版）"
  CreateShortcut "$SMPROGRAMS\Blocky Studio（测试版）\Blocky Studio（测试版）.lnk" "$INSTDIR\Blocky Studio.exe" "" "$INSTDIR\Blocky Studio.exe"
  CreateShortcut "$SMPROGRAMS\Blocky Studio（测试版）\卸载测试版.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Blocky Studio（测试版）.lnk" "$INSTDIR\Blocky Studio.exe" "" "$INSTDIR\Blocky Studio.exe"
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "DisplayName" "${BETA_DISPLAY_NAME}"
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "DisplayVersion" "${RELEASE_VERSION}"
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "Publisher" "Blocky"
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Blocky Studio.exe"
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${BETA_UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "${BETA_UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${BETA_UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${BETA_UNINSTALL_KEY}" "EstimatedSize" ${INSTALLED_KIB}
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
