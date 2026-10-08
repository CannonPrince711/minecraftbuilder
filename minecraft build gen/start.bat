@echo off
rem RL Build Generator - double-click to start the program.
rem From a terminal:  start.bat help   for command-line use, e.g.
rem   start.bat generate --prompt "3 tall spruce watchtowers" --mc 1.20
rem   start.bat train-all
title RL Build Generator (keep this window open)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org ^(version 18 or newer^), then run this again.
  pause
  exit /b 1
)
node src\launcher.js %*
if errorlevel 1 pause
