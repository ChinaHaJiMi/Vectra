@echo off
REM ============================================================
REM VECTRA — 一键安装脚本 (Windows)
REM 用法: 双击运行 或 在 cmd 中执行 install.bat
REM 行为: 拉取代码 → 生成启动器 → 创建桌面快捷方式
REM ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul
title VECTRA 一键安装

set "REPO_URL=https://github.com/ChinaHaJiMi/Vectra.git"
set "INSTALL_DIR=%USERPROFILE%\Vectra"
set "PROJECT_URL=http://localhost:8080"
set "UPDATE_EVERY=20"

echo ======================================
echo   VECTRA - AI NPC 模拟系统 一键安装
echo ======================================
echo.

REM ---- 0. 环境检测 ----
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY (
  echo [!] 未找到 Python。请先安装: https://www.python.org/downloads/ ^(安装时勾选 "Add to PATH"^)
  pause & exit /b 1
)
where git >nul 2>nul || (
  echo [!] 未找到 Git。请先安装: https://git-scm.com/download/win
  pause & exit /b 1
)
%PY% --version
git --version
echo [OK] 环境检测通过
echo.

REM ---- 1. 拉取代码 ----
if exist "%INSTALL_DIR%\.git" (
  echo 检测到已安装版本，正在更新...
  git -C "%INSTALL_DIR%" pull --ff-only --quiet && echo [OK] 代码已更新 || echo [!] 更新失败，继续使用现有版本
) else (
  echo 正在克隆仓库到 %INSTALL_DIR% ...
  git clone --depth 1 "%REPO_URL%" "%INSTALL_DIR%"
  if errorlevel 1 (
    echo [X] 克隆失败。请检查网络或仓库地址: %REPO_URL%
    pause & exit /b 1
  )
  echo [OK] 代码克隆完成
)
echo.

REM ---- 2. 生成启动器 Vectra.cmd ----
(
echo @echo off
echo chcp 65001 ^>nul
echo cd /d "%INSTALL_DIR%"
echo set COUNT=0
echo if exist .vectra_launch_count set /p COUNT=^<.vectra_launch_count
echo set /a COUNT+=1
echo echo %%COUNT%%^>.vectra_launch_count
echo set /a MOD=%%COUNT%% %%%% %UPDATE_EVERY%
echo if "%%MOD%%"=="0" ^(
echo   echo [Vectra] 第 %%COUNT%% 次启动，检查更新...
echo   git pull --ff-only --quiet 2^>nul ^&^& echo [Vectra] 已更新 ^|^| echo [Vectra] 无更新或离线
echo ^)
echo set VECTRA_NO_SSL=1
echo start "" /b cmd /c "timeout /t 2 /nobreak ^>nul ^& start "" "%PROJECT_URL%""
echo echo Vectra 已启动: %PROJECT_URL%  ^(Ctrl+C 停止^)
echo python server.py
echo pause
) > "%INSTALL_DIR%\Vectra.cmd"
echo [OK] 启动器已生成: %INSTALL_DIR%\Vectra.cmd

REM ---- 3. 创建桌面快捷方式 ----
if exist "%~dp0make-shortcut.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-shortcut.ps1" -TargetPath "%INSTALL_DIR%\Vectra.cmd"
  echo [OK] 桌面快捷方式已创建
) else (
  echo [!] 未找到 make-shortcut.ps1，跳过快捷方式创建
)
echo.

REM ---- 4. 完成 ----
echo ======================================
echo   VECTRA 安装完成！
echo   安装目录: %INSTALL_DIR%
echo   数据目录: %USERPROFILE%\VectraData
echo   双击桌面 Vectra 图标即可启动
echo ======================================
pause
