@echo off
setlocal
cd /d "%~dp0"
py -3 --version >nul 2>&1
if errorlevel 1 (
 echo Install Python 3.10 or newer from https://www.python.org/downloads/windows/ then run this file again.
 pause
 exit /b 1
)
py -3 -m venv "%LOCALAPPDATA%\YandexVideoDownloader\native\venv"
if errorlevel 1 goto failed
"%LOCALAPPDATA%\YandexVideoDownloader\native\venv\Scripts\python.exe" -m pip install --disable-pip-version-check --index-url https://pypi.org/simple "yt-dlp[default]" send2trash imageio-ffmpeg
if errorlevel 1 goto failed
"%LOCALAPPDATA%\YandexVideoDownloader\native\venv\Scripts\python.exe" "%~dp0native\register_windows.py"
if errorlevel 1 goto failed
echo Helper installed. Open the extension and check connection.
echo For separate high-quality video and audio streams install FFmpeg from https://ffmpeg.org/download.html
pause
exit /b 0
:failed
echo Installation failed. Keep this window open for diagnostics.
pause
exit /b 1
