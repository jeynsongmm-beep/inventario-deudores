@echo off
title Maria Collection - Servidor + Tunel HTTPS (Cloudflare)
cd /d "D:\Proyectos\inventario-deudores"
echo ============================================
echo   Maria Collection - Servidor + Tunel HTTPS
echo ============================================
echo.
echo Iniciando servidor local...
start "Maria Server" /B "C:\Program Files\nodejs\node.exe" "server.js"
timeout /t 3 /nobreak >nul
echo Iniciando tunel Cloudflare (HTTPS)...
del "tunnel-url.txt" 2>nul
start "Maria Tunnel" /B cmd /c ""C:\Program Files\nodejs\node.exe" tunnel.js"
echo Esperando URL del tunel...
timeout /t 12 /nobreak >nul
echo.
if exist "tunnel-url.txt" (
  set /p TUNNEL_URL=<tunnel-url.txt
  echo ============================================
  echo   URL PUBLICA (HTTPS): %TUNNEL_URL%
  echo ============================================
) else (
  echo   ERROR: No se pudo obtener la URL del tunel.
  echo   Revisa si cloudflared necesita autenticacion.
)
echo.
echo   URL local:  http://localhost:3000
echo.
echo Accede desde cualquier lugar con la URL HTTPS.
echo Cierra esta ventana para detener todo.
echo.
pause
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
