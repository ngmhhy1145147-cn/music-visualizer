@echo off
title 音乐可视化
cd /d "%~dp0"

rem ---- 检测 8080 端口是否已有服务器在运行 ----
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 goto open

rem ---- 启动本地服务器（优先 python，其次 py 启动器） ----
where python >nul 2>&1
if %errorlevel%==0 (
  start "音乐可视化 - 服务器" cmd /k python -m http.server 8080 --bind 127.0.0.1
  goto wait
)
where py >nul 2>&1
if %errorlevel%==0 (
  start "音乐可视化 - 服务器" cmd /k py -m http.server 8080 --bind 127.0.0.1
  goto wait
)

echo 未找到 Python，请先安装 Python（安装时勾选 Add to PATH）。
echo 下载地址：https://www.python.org/downloads/
pause
exit /b 1

:wait
timeout /t 2 /nobreak >nul

:open
start "" "http://127.0.0.1:8080"
echo 已在浏览器打开：http://127.0.0.1:8080
echo 停止服务器：关闭"音乐可视化 - 服务器"窗口即可。
timeout /t 6 >nul
