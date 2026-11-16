@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OpenChat Guard
rem 啟動 QR 守衛，當掉會自動重啟。是否真的刪除／封鎖由 config.json 的 dryRun 決定。
rem 直接用 node 啟動而不是 npm run guard：經過 npm 的話，按一下 Ctrl+C 就會讓 npm 先結束、
rem 守衛卻還在背景跑，這個視窗會誤以為程式結束而再開一個。
:loop
echo [%date% %time%] 啟動 QR 守衛...
node --import tsx/esm src\guard-qr.ts
echo [%date% %time%] 程式結束，10 秒後自動重新啟動（要停止請關閉這個視窗）
timeout /t 10 /nobreak >nul
goto loop
