@echo off
title Maria Collection - Servidor + Cloudflare Tunnel
cd /d "D:\Proyectos\inventario-deudores"
echo ============================================
echo   Maria Collection - Servidor + Tunel
echo ============================================
echo.
echo Iniciando servidor...
start "Maria Collection Server" /B "C:\Program Files\nodejs\node.exe" "server.js"
timeout /t 3 /nobreak >nul
echo.
echo Iniciando tunel Cloudflare...
echo La URL aparecera abajo cuando este listo (10-15 segundos)
echo.
start "Maria Collection Tunnel" /B "cloudflared.exe" tunnel --url http://localhost:3000 --no-autoupdate
timeout /t 12 /nobreak >nul
echo.
echo Buscando URL del tunel...
if exist "C:\Users\%USERNAME%\.cloudflared\cert.json" (
  echo Tunel iniciado. Revisa la otra ventana para la URL.
) else (
  echo Si es la primera vez, cloudflared puede pedir autenticacion.
  echo Revisa la ventana "Cloudflare Tunnel" que se acaba de abrir.
)
echo.
echo   URL local:  http://localhost:3000
echo.
echo NOTA: La URL publica aparece en la ventana "Cloudflare Tunnel".
echo Si no ves la URL, espera unos segundos mas.
echo Cierra esta ventana para detener todo.
echo.
pause
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
