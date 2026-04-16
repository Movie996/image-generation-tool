@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo =====================================================
echo         图器 3.0 - 正在启动...
echo =====================================================
echo.

::: ─────────────────────────────────────────────
::: 第一步：检测 Node.js 是否已安装
::: ─────────────────────────────────────────────
echo [1/3] 正在检测 Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  ❌ 未检测到 Node.js，正在尝试自动安装...
    echo.

    :: 先检测 winget 是否可用（Win10 1709+ 自带）
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo  正在使用 winget 安装 Node.js LTS，请稍候...
        echo  （可能需要 2-5 分钟，请勿关闭此窗口）
        echo.
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        if %errorlevel% neq 0 (
            echo.
            echo  ❌ 自动安装失败，请手动下载安装后重试。
            start "" https://nodejs.org/zh-cn/download
            pause
            exit /b 1
        )
        echo.
        echo  ✅ Node.js 安装完成！
        echo  ⚠️  请关闭此窗口，重新双击启动工具.bat 以应用新安装的 Node.js
        echo.
        pause
        exit /b 0
    ) else (
        echo  ┌─────────────────────────────────────────────┐
        echo  │  ⚠️  无法自动安装（系统不支持 winget）        │
        echo  │                                             │
        echo  │  请手动安装：                               │
        echo  │  1. 稍后将自动打开 Node.js 官网              │
        echo  │  2. 下载 LTS（长期支持）版本                 │
        echo  │  3. 安装完成后重新双击本文件                  │
        echo  └─────────────────────────────────────────────┘
        echo.
        start "" https://nodejs.org/zh-cn/download
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo     ✅ Node.js 已安装：%NODE_VER%

:: 检查版本是否满足最低要求（>=20.6，因为用了 --env-file 参数）
for /f "tokens=1 delims=." %%m in ("%NODE_VER:v=%") do set NODE_MAJOR=%%m
if %NODE_MAJOR% LSS 20 (
    echo.
    echo  ⚠️  当前 Node.js 版本过低（%NODE_VER%），本工具需要 v20.6 或以上版本。
    echo  请访问 https://nodejs.org 下载最新 LTS 版本后重试。
    echo.
    pause
    exit /b 1
)

::: ─────────────────────────────────────────────
::: 第二步：安装项目依赖（仅首次运行）
::: ─────────────────────────────────────────────
echo.
echo [2/3] 正在检测项目依赖...
if not exist "node_modules\" (
    echo     首次运行，正在安装依赖包，请耐心等待...
    echo     （仅需安装一次，大约需要 1-2 分钟）
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo  ❌ 依赖安装失败！请检查网络连接后重试。
        echo.
        pause
        exit /b 1
    )
    echo.
    echo     ✅ 依赖安装完成！
) else (
    echo     ✅ 依赖已就绪，跳过安装
)

::: ─────────────────────────────────────────────
::: 第三步：启动服务器（在当前窗口中运行）
::: ─────────────────────────────────────────────
echo.
echo [3/3] 正在启动服务器...
echo.
echo =====================================================
echo   服务器地址：http://localhost:3000
echo   关闭此窗口 或 按 Ctrl+C 可停止服务器
echo =====================================================
echo.

::: 启动服务器（app.js 内部会自动打开浏览器，无需在此重复打开）
npm start
