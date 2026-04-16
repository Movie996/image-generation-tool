#!/bin/bash

# ============================================================
#  Image Generation Tool - Linux/macOS 启动脚本
#  版本: 3.0
# ============================================================

echo "===================================="
echo "   Image Generation Tool v3.0"
echo "   正在启动..."
echo "===================================="
echo ""

cd "$(dirname "$0")"

# ── 检查 Node.js（>=20.6）──
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js！"
    echo "请先安装 Node.js >= 20.6: https://nodejs.org/"
    echo ""
    read -p "按 Enter 退出..."
    exit 1
fi

NODE_VER=$(node -v)
echo "  ✅ Node.js：$NODE_VER"

NODE_MAJOR=$(echo "$NODE_VER" | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "[错误] Node.js 版本过低（需要 >= 20.6），当前：$NODE_VER"
    read -p "按 Enter 退出..."
    exit 1
fi

# ── 安装依赖（仅首次）──
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
    echo "  ✅ 依赖已就绪"
fi

# ── 读取端口配置 ──
PORT=$(grep -E "^PORT=" .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3000}

echo ""
echo "===================================="
echo "  服务器地址：http://localhost:$PORT"
echo "  按 Ctrl+C 可停止服务器"
echo "===================================="
echo ""

# ── 延迟打开浏览器（后台）──
(sleep 2 && \
  if command -v open &>/dev/null; then
    open "http://localhost:$PORT"       # macOS
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"   # Linux
  fi
) &

# ── 启动服务器 ──
node --env-file=.env server/app.js
