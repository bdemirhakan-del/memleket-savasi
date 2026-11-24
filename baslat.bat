@echo off
title Memleket Savasi Sunucusu
cd /d C:\MemleketSavasi
:dongu
node server.js
echo.
echo Program kapandi. 5 saniye sonra kendiliginden tekrar acilacak...
timeout /t 5 >nul
goto dongu
