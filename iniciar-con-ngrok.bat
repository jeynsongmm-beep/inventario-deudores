@echo off
title Maria Collection - Servidor + Ngrok
echo Iniciando servidor Maria Collection...
start "Maria Collection Server" /B "C:\Program Files\nodejs\node.exe" "D:\Proyectos\inventario-deudores\server.js"
timeout /t 3 /nobreak >nul
echo Iniciando tunel ngrok...
start "Ngrok Tunnel" /B cmd /c "C:\Program Files\nodejs\npx.cmd" ngrok http 3000 --log=stdout 2>&1
echo.
echo Servidor corriendo en http://localhost:3000
echo Tunel ngrok iniciado - Revisa la ventana de ngrok para la URL publica
echo Para cerrar todo, cierra esta ventana y ejecuta: taskkill /f /im node.exe
echo.
pause
