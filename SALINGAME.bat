@echo off
cd /d %~dp0
start cmd /k "node server.js"
start http://localhost:3000
exit
