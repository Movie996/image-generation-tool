#!/bin/bash

# ============================================================
#  Image Generation Tool v3.0 - 启动脚本
#  已配置国内镜像源，每次启动自动同步依赖版本
# ============================================================

# 国内镜像源
NPM_REGISTRY="https://registry.npmmirror.com"
PIP_MIRROR="https://mirrors.cloud.tencent.com/pypi/simple/"
PIP_MIRROR_BACKUP="https://pypi.tuna.tsinghua.edu.cn/simple/"

echo "===================================="
echo "   Image Generation Tool v3.0"
echo "   正在启动..."
echo "===================================="
echo ""

cd "$(dirname "$0")"

# ══════════════════════════════════════════════
# 第一步：检测 Node.js（>=20.6）
# ══════════════════════════════════════════════
echo "[1/4] 检测 Node.js..."

if ! command -v node &> /dev/null; then
    echo ""
    echo "  ❌ 未检测到 Node.js！"
    echo ""
    echo "  请先安装 Node.js >= 20.6："
    echo "  - macOS:  brew install node@20"
    echo "  - Ubuntu: sudo apt install nodejs"
    echo "  - 手动下载: https://npmmirror.com/mirrors/node/"
    echo ""
    read -p "  按 Enter 退出..."
    exit 1
fi

NODE_VER=$(node -v)
echo "  ✅ Node.js：$NODE_VER"

NODE_MAJOR=$(echo "$NODE_VER" | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "  ❌ Node.js 版本过低（需要 >= 20.6），当前：$NODE_VER"
    echo "  下载：https://npmmirror.com/mirrors/node/"
    read -p "  按 Enter 退出..."
    exit 1
fi

# ══════════════════════════════════════════════
# 第二步：安装/更新 Node.js 依赖（使用国内镜像）
# 每次都运行 npm install，已装过的包会自动跳过，
# 版本不对的包会自动升级到 package.json 要求的版本
# ══════════════════════════════════════════════
echo ""
echo "[2/4] 安装/更新 Node.js 依赖..."
echo "  （使用国内镜像源，已装过的包会自动跳过或升级版本）"
npm install --registry="$NPM_REGISTRY"
if [ $? -ne 0 ]; then
    echo "  ⚠️  安装失败，清除缓存后重试..."
    npm cache clean --force 2>/dev/null
    npm install --registry="$NPM_REGISTRY"
    if [ $? -ne 0 ]; then
        echo "  ❌ 依赖安装失败！请检查网络后重试。"
        read -p "  按 Enter 退出..."
        exit 1
    fi
fi
echo "  ✅ Node.js 依赖已就绪"

# ══════════════════════════════════════════════
# 第三步：检测 Python + 安装/更新 Python 依赖
# 每次都运行 pip install，已装过的包会自动跳过，
# 版本不对的包会自动升级到 requirements.txt 要求的版本
# ══════════════════════════════════════════════
echo ""
echo "[3/4] 检测 Python 环境..."

PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
fi

if [ -z "$PYTHON_CMD" ]; then
    echo "  ⚠️  未检测到 Python，宫格拆分功能将不可用"
    echo "  （AI 图片/视频生成功能仍可正常使用）"
    echo ""
    echo "  如需宫格拆分功能，请安装 Python 3.8+："
    echo "  - macOS:  brew install python3"
    echo "  - Ubuntu: sudo apt install python3 python3-pip"
    echo "  - 手动下载: https://mirrors.huaweicloud.com/python/"
    echo ""
    echo "  继续启动服务器（宫格拆分功能不可用）..."
else
    PYTHON_VER=$($PYTHON_CMD --version 2>&1)
    echo "  ✅ $PYTHON_VER"

    # 检测 pip
    if $PYTHON_CMD -m pip --version &> /dev/null; then
        # 安装/更新 Python 依赖（每次都执行，确保版本一致）
        echo "  正在安装/更新 Python 依赖..."
        echo "  （使用国内镜像源，已装过的包会自动跳过或升级版本）"
        $PYTHON_CMD -m pip install -r requirements.txt -i "$PIP_MIRROR" --trusted-host mirrors.cloud.tencent.com
        if [ $? -ne 0 ]; then
            echo "  ⚠️  腾讯云镜像安装失败，尝试备用镜像（清华源）..."
            $PYTHON_CMD -m pip install -r requirements.txt -i "$PIP_MIRROR_BACKUP" --trusted-host pypi.tuna.tsinghua.edu.cn
            if [ $? -ne 0 ]; then
                echo "  ❌ Python 依赖安装失败！宫格拆分功能将不可用"
                echo "  你可以稍后手动执行：$PYTHON_CMD -m pip install -r requirements.txt -i $PIP_MIRROR"
            else
                echo "  ✅ Python 依赖已就绪（清华源）"
            fi
        else
            echo "  ✅ Python 依赖已就绪"
        fi
    else
        echo "  ⚠️  pip 不可用，正在尝试安装..."
        $PYTHON_CMD -m ensurepip --default-pip 2>/dev/null
        if [ $? -ne 0 ]; then
            echo "  ❌ pip 安装失败，宫格拆分功能将不可用"
            echo "  请手动安装 pip 后重试"
        else
            echo "  ✅ pip 安装成功，正在安装 Python 依赖..."
            $PYTHON_CMD -m pip install -r requirements.txt -i "$PIP_MIRROR" --trusted-host mirrors.cloud.tencent.com
            if [ $? -ne 0 ]; then
                echo "  ⚠️  腾讯云镜像失败，尝试备用镜像（清华源）..."
                $PYTHON_CMD -m pip install -r requirements.txt -i "$PIP_MIRROR_BACKUP" --trusted-host pypi.tuna.tsinghua.edu.cn
            fi
            if [ $? -eq 0 ]; then
                echo "  ✅ Python 依赖已就绪"
            else
                echo "  ❌ Python 依赖安装失败！宫格拆分功能将不可用"
            fi
        fi
    fi
fi

# ══════════════════════════════════════════════
# 第四步：启动服务器
# ══════════════════════════════════════════════
echo ""
echo "[4/4] 正在启动服务器..."

PORT=$(grep -E "^PORT=" .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3000}

echo ""
echo "===================================="
echo "  服务器地址：http://localhost:$PORT"
echo "  按 Ctrl+C 可停止服务器"
echo "===================================="
echo ""

# 延迟打开浏览器（后台）
(sleep 2 && \
  if command -v open &>/dev/null; then
    open "http://localhost:$PORT"       # macOS
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"   # Linux
  fi
) &

# 启动服务器
node --env-file=.env server/app.js
