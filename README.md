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

- Node.js >= 20.6
- npm

### Windows 用户

双击 `启动工具.bat` 即可。

### Linux / macOS 用户

```bash
chmod +x 启动工具.sh
./启动工具.sh
```

### 手动启动

```bash
npm install
cp .env.example .env   # 编辑 .env 填入你的 API Key
npm start
```

服务器默认运行在 http://localhost:3000

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
