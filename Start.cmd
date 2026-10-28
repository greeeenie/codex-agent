@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js LTS с https://nodejs.org/ и запустите агент ещё раз.
  pause
  exit /b 1
)
where codex >nul 2>nul
if errorlevel 1 (
  echo Устанавливаем официальный Codex CLI...
  call npm install -g @openai/codex
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node runner/start.mjs
pause
