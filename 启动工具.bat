@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo =====================================================
echo         图器 3.0 - 正在启动...
echo =====================================================
echo.

:: ─────────────────────────────────────────────
:: 国内镜像源配置
:: ─────────────────────────────────────────────
set "NPM_REGISTRY=https://registry.npmmirror.com"
set "PIP_MIRROR=https://mirrors.cloud.tencent.com/pypi/simple/"
set "PIP_MIRROR_BACKUP=https://pypi.tuna.tsinghua.edu.cn/simple/"

:: ══════════════════════════════════════════════
:: 第一步：检测并安装 Node.js
:: ══════════════════════════════════════════════
echo [1/4] 正在检测 Node.js...

where node >nul 2>nul
if !errorlevel! neq 0 (
    echo.
    echo  ❌ 未检测到 Node.js，正在尝试自动安装...
    echo.

    where winget >nul 2>nul
    if !errorlevel! equ 0 (
        echo  正在使用 winget 安装 Node.js LTS，请稍候...
        echo  （可能需要 2-5 分钟，请勿关闭此窗口）
        echo.
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        if !errorlevel! neq 0 (
            echo.
            echo  ❌ 自动安装失败，请手动下载安装后重试。
            echo  国内镜像下载：https://npmmirror.com/mirrors/node/
            start "" https://npmmirror.com/mirrors/node/
            pause
            exit /b 1
        )
        echo.
        echo  ✅ Node.js 安装完成！
        echo  ⚠️  请关闭此窗口，重新双击 启动工具.bat 以应用新安装的 Node.js
        echo.
        pause
        exit /b 0
    ) else (
        echo  ┌─────────────────────────────────────────────┐
        echo  │  ⚠️  无法自动安装（系统不支持 winget）        │
        echo  │                                             │
        echo  │  请手动安装：                               │
        echo  │  1. 稍后将自动打开国内镜像下载页             │
        echo  │  2. 下载 LTS（长期支持）版本                 │
        echo  │  3. 安装完成后重新双击本文件                  │
        echo  └─────────────────────────────────────────────┘
        echo.
        start "" https://npmmirror.com/mirrors/node/
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
echo     ✅ Node.js 已安装：!NODE_VER!

:: 检查版本是否满足最低要求（>=20.6，因为用了 --env-file 参数）
for /f "tokens=1 delims=." %%m in ("!NODE_VER:v=!") do set "NODE_MAJOR=%%m"
if !NODE_MAJOR! LSS 20 (
    echo.
    echo  ⚠️  当前 Node.js 版本过低（!NODE_VER!），本工具需要 v20.6 或以上版本。
    echo  国内镜像下载：https://npmmirror.com/mirrors/node/
    echo.
    pause
    exit /b 1
)

:: ══════════════════════════════════════════════
:: 第二步：安装/更新 Node.js 依赖（使用国内镜像）
:: 每次都运行 npm install，已装过的包会自动跳过，
:: 版本不对的包会自动升级到 package.json 要求的版本
:: ══════════════════════════════════════════════
echo.
echo [2/4] 正在安装/更新 Node.js 依赖...
echo     （使用国内镜像源，已装过的包会自动跳过或升级版本）
echo.
call npm install --registry=!NPM_REGISTRY!
if !errorlevel! neq 0 (
    echo.
    echo  ⚠️  安装失败，正在清除缓存后重试...
    call npm cache clean --force >nul 2>nul
    call npm install --registry=!NPM_REGISTRY!
    if !errorlevel! neq 0 (
        echo.
        echo  ❌ 依赖安装失败！请检查网络连接后重试。
        echo.
        pause
        exit /b 1
    )
)
echo     ✅ Node.js 依赖已就绪

:: ══════════════════════════════════════════════
:: 第三步：检测 Python + 安装/更新 Python 依赖
:: 每次都运行 pip install，已装过的包会自动跳过，
:: 版本不对的包会自动升级到 requirements.txt 要求的版本
:: ══════════════════════════════════════════════
echo.
echo [3/4] 正在检测 Python 环境...

set "PYTHON_CMD="
where python >nul 2>nul
if !errorlevel! equ 0 set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
    where python3 >nul 2>nul
    if !errorlevel! equ 0 set "PYTHON_CMD=python3"
)

if not defined PYTHON_CMD (
    echo.
    echo  ⚠️  未检测到 Python，宫格拆分功能将不可用
    echo  （AI 图片/视频生成功能仍可正常使用）
    echo.
    echo  如需宫格拆分功能，请安装 Python 3.8+：
    echo  华为镜像下载：https://mirrors.huaweicloud.com/python/
    echo.
    choice /C YN /M "  是否现在打开下载页面 (Y/N)"
    if !errorlevel! equ 1 start "" https://mirrors.huaweicloud.com/python/
    echo.
    echo  继续启动服务器（宫格拆分功能不可用）...
    echo.
    goto start_server
)

for /f "tokens=*" %%v in ('!PYTHON_CMD! --version 2^>nul') do set "PYTHON_VER=%%v"
echo     ✅ !PYTHON_VER!

:: 检测 pip 是否可用
!PYTHON_CMD! -m pip --version >nul 2>nul
if !errorlevel! neq 0 (
    echo     ⚠️  pip 不可用，正在尝试安装...
    !PYTHON_CMD! -m ensurepip --default-pip >nul 2>nul
    if !errorlevel! neq 0 (
        echo     ❌ pip 安装失败，宫格拆分功能将不可用
        echo     继续启动服务器（宫格拆分功能不可用）...
        echo.
        goto start_server
    )
    echo     ✅ pip 安装成功
)

:: 安装/更新 Python 依赖（使用国内镜像）
echo     正在安装/更新 Python 依赖...
echo     （使用国内镜像源，已装过的包会自动跳过或升级版本）
echo.
!PYTHON_CMD! -m pip install -r requirements.txt -i !PIP_MIRROR! --trusted-host mirrors.cloud.tencent.com
if !errorlevel! neq 0 (
    echo.
    echo  ⚠️  腾讯云镜像安装失败，正在尝试备用镜像（清华源）...
    !PYTHON_CMD! -m pip install -r requirements.txt -i !PIP_MIRROR_BACKUP! --trusted-host pypi.tuna.tsinghua.edu.cn
    if !errorlevel! neq 0 (
        echo.
        echo  ❌ Python 依赖安装失败！宫格拆分功能将不可用
        echo  （AI 图片/视频生成功能仍可正常使用）
        echo.
        echo  你可以稍后手动执行：
        echo  !PYTHON_CMD! -m pip install -r requirements.txt -i !PIP_MIRROR!
        echo.
        goto start_server
    )
)
echo     ✅ Python 依赖已就绪

:start_server
:: ══════════════════════════════════════════════
:: 第四步：启动服务器
:: ══════════════════════════════════════════════
echo.
echo [4/4] 正在启动服务器...
echo.
echo =====================================================
echo   服务器地址：http://localhost:3000
echo   关闭此窗口 或 按 Ctrl+C 可停止服务器
echo =====================================================
echo.

npm start
