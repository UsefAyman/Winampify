@echo off
title Winampify server
cd /d "%~dp0"
echo Winampify is running at http://127.0.0.1:8888/
echo Keep this window open while you listen. Close it to stop.
start "" cmd /c "timeout /t 1 >nul & start http://127.0.0.1:8888/"
python server.py
