@echo off
setlocal
cd /d "%~dp0"
pnpm exec node scripts/start-local.mjs
if errorlevel 1 pause
