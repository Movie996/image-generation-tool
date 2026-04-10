#!/bin/bash

echo "===================================="
echo "   生图生视频工具 - 启动中..."
echo "===================================="
echo ""

cd "$(dirname "$0")"

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js！"
    echo "请先安装 Node.js: https://nodejs.org/"
    echo ""
    read -p "按任意键退出..."
    exit 1
fi

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "[提示] 首次运行，正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败！"
        read -p "按任意键退出..."
        exit 1
    fi
    echo ""
fi

# 启动服务器
echo "[启动] 正在启动服务器..."
echo "[提示] 浏览器将自动打开，按 Ctrl+C 停止服务"
echo ""

node --env-file=.env server/app.js
