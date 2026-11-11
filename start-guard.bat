@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OpenChat Guard
rem 啟動 QR 守衛，當掉會自動重啟。是否真的刪除／封鎖由 config.json 的 dryRun 決定。
:loop
echo [%date% %time%] 啟動 QR 守衛...
call npm run guard
echo [%date% %time%] 程式結束，10 秒後自動重新啟動（要停止請關閉這個視窗）
timeout /t 10 /nobreak >nul
goto loop
