@echo off
setlocal
set "NODE_USE_ENV_PROXY=1"
if defined NO_PROXY set "NO_PROXY=%NO_PROXY%,localhost,127.0.0.1,::1"
if not defined NO_PROXY set "NO_PROXY=localhost,127.0.0.1,::1"
set "TESTIMUS_HOME_BIN=%~dp0"
"%~dp0node\node.exe" "%~dp0app\testimus.mjs" %*
exit /b %ERRORLEVEL%
