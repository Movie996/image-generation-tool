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
    read -p "按 Enter 退出..."
    exit 1
fi

echo "  ✅ Node.js 已安装：$(node -v)"

# 检查依赖是否安装
echo ""
if [ ! -d "node_modules" ]; then
    echo "  首次运行，正在安装依赖（约需 1-2 分钟）..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败！请检查网络后重试。"
        read -p "按 Enter 退出..."
        exit 1
    fi
    echo "  ✅ 依赖安装完成！"
else
    echo "  ✅ 依赖已就绪，跳过安装"
fi

# 读取端口配置（默认 3000）
PORT=$(grep -E "^PORT=" .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3000}

echo ""
echo "===================================="
echo "  服务器地址：http://localhost:$PORT"
echo "  按 Ctrl+C 可停止服务器"
echo "===================================="
echo ""

# 延迟 2 秒后自动打开浏览器（后台运行，不阻塞服务器）
(sleep 2 && \
  if command -v open &>/dev/null; then
    open "http://localhost:$PORT"       # macOS
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"   # Linux
  fi
) &

# 启动服务器（前台运行，日志实时可见）
node --env-file=.env server/app.js

