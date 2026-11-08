@echo off
rem Opens this test run in the browser, served on 127.0.0.1 by serve.mjs (results are written into this folder).
rem Node comes from the PATH, else from an installed Testimus; without Node the page opens on its own and keeps the
rem results in the browser (use « Save run.json »).
setlocal
cd /d "%~dp0"
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\Testimus\current.txt" (
  set /p TV=<"%LOCALAPPDATA%\Testimus\current.txt"
)
if not defined NODE if defined TV if exist "%LOCALAPPDATA%\Testimus\%TV%\node\node.exe" set "NODE=%LOCALAPPDATA%\Testimus\%TV%\node\node.exe"
if not defined NODE (
  echo Node was not found: the page opens on its own and keeps the results in this browser.
  echo When you are done, press « Save run.json » and put the file back in this folder.
  start "" "%~dp0index.html"
  exit /b 0
)
"%NODE%" "%~dp0serve.mjs" %*
