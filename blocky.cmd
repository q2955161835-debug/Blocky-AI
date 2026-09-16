@echo off
node "%~dp0tools\blocky-cli\dist\main.mjs" %*
exit /b %errorlevel%
