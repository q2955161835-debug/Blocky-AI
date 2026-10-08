; Shared by the production installer and isolated, filesystem-only NSIS tests.
!macro CHECK_INSTALL_WRITE
  IfErrors 0 +2
  Call InstallationFailed
!macroend

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

Function InstallationFailed
  !insertmacro CLEANUP_FAILED_INSTALL
  MessageBox MB_OK|MB_ICONSTOP "测试版安装未完成，未注册为成功安装。已尝试清理本轮写入的安装文件；不可写或正在使用的文件可能仍留在所选目录。作品和用户配置未清理。请解决目录权限、磁盘空间或文件占用后，选择空目录重试。" /SD IDOK
  SetErrorLevel 9
  Quit
FunctionEnd

Function .onInstFailed
  Call InstallationFailed
FunctionEnd
