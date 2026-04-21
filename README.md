# Image Generation Tool v3.0

AI 图片/视频生成 + 九宫格拆分 一体化工具。

## 功能

- **AI 图片生成** — 通过 Tuzi API（nanobanana-2 模型）文生图，支持自定义尺寸和风格
- **AI 视频生成** — 图生视频 / 文生视频
- **九宫格自动拆分** — 将图片拆分为 4/6/9/12/16 宫格，支持自定义行列数
- **任务队列管理** — 异步生成，实时状态轮询，支持重试

## 技术栈

- **前端**: 原生 HTML/CSS/JS（无框架）
- **后端**: Express.js (Node.js)
- **数据库**: LowDB（JSON 文件存储）
- **API**: Tuzi AI (nanobanana-2)

## 快速开始

### 环境要求

| 依赖 | 版本要求 | 用途 | 是否必须 |
|------|---------|------|---------|
| Node.js | >= 20.6 | 后端服务 | ✅ 必须 |
| Python | >= 3.8 | 宫格拆分（腾讯云 SDK） | ⚠️ 可选（无 Python 则宫格拆分不可用） |

> **提示**：启动脚本已配置国内镜像源，依赖安装会自动使用淘宝/腾讯云/清华镜像，无需手动配置。

### Windows 用户

双击 `启动工具.bat` 即可，脚本会自动：
1. 检测 Node.js（未安装则自动安装或打开下载页）
2. 使用淘宝镜像安装 Node.js 依赖
3. 检测 Python（未安装则提示下载，不影响其他功能）
4. 使用腾讯云镜像安装 Python 依赖（腾讯云 SDK 等）
5. 启动服务器

### Linux / macOS 用户

```bash
chmod +x 启动工具.sh
./启动工具.sh
```

### 手动启动

```bash
# Node.js 依赖（已配置 .npmrc 淘宝镜像）
npm install

# Python 依赖（如需宫格拆分功能）
pip install -r requirements.txt -i https://mirrors.cloud.tencent.com/pypi/simple/ --trusted-host mirrors.cloud.tencent.com

# 配置环境变量
cp .env.example .env   # 编辑 .env 填入你的 API Key

# 启动
npm start
```

服务器默认运行在 http://localhost:3000

### 国内镜像源说明

本项目预配置了以下国内镜像源，加速依赖下载：

| 工具 | 镜像源 | 配置方式 |
|------|--------|---------|
| npm | https://registry.npmmirror.com (淘宝) | `.npmrc` 文件 + 启动脚本 `--registry` 参数 |
| pip | https://mirrors.cloud.tencent.com/pypi/simple/ (腾讯云) | 启动脚本 `-i` 参数 |
| pip 备用 | https://pypi.tuna.tsinghua.edu.cn/simple/ (清华) | 腾讯云源失败时自动切换 |
| Node.js 下载 | https://npmmirror.com/mirrors/node/ | 安装提示中提供 |

## 项目结构

```
image-generation-tool/
├── public/                  # 前端静态文件
│   ├── index.html          # 主页面
│   ├── app.js              # 前端逻辑
│   ├── styles.css          # 样式
│   └── grid-output/        # 生成的宫格输出（运行时生成）
├── server/                 # 后端代码
│   ├── app.js              # 主服务入口
│   ├── db.js               # 数据库层（LowDB）
│   ├── jobs/pollWorker.js  # 任务轮询器
│   ├── api/tuzi.js         # Tuzi API 封装
│   ├── routes/gridSplit.js # 九宫格路由
│   ├── scripts/            # 辅助脚本
│   └── public/             # 服务端静态资源
├── docs/                   # 文档
│   └── DESIGN.md           # UI 设计规范（Linear 风格参考）
├── 启动工具.bat             # Windows 启动脚本
├── 启动工具.sh              # Linux/macOS 启动脚本
├── package.json
└── .env                    # 环境配置（含 API Key，不提交到 Git）
```

## 配置说明

编辑 `.env` 文件：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `TUZI_API_KEY` | Tuzi API 密钥 | 必填 |

## License

MIT
