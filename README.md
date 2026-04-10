# 🎨 Image Generation Tool

> AI 图片生成工具 — 文生图 / 图生图，基于 nanobanana-2 模型（通过兔子 API）

![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

## ✨ 功能特性

- 📝 **文生图 (Text-to-Image)** — 输入提示词，一键生成图片
- 🖼️ **图生图 (Image-to-Image)** — 上传本地图片或输入 URL，根据提示词转换风格
- ⚡ **队列模式** — 提交即释放，连续提交不阻塞 UI
- 🔔 **即时反馈** — 居中弹窗显示提交成功（2秒自动消失）
- 📊 **历史记录** — 完整任务管理：查看、下载、重试、删除
- 🔄 **智能刷新** — 增量更新防抖动，不会打断复制操作
- 💻 **后台运行** — 服务独立于窗口运行，关掉 bat 也能用
- 🛑 **一键停止** — 双击停止脚本即可关闭服务

---

## 🚀 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 18.0
- 兔子 API Token（[获取方式](#-获取-api-token)）

### Windows 用户（推荐）

**启动：**
```
双击 启动工具.bat
```

效果：
1. ✅ 自动检查 Node.js 和依赖
2. ✅ 后台启动服务（无终端窗口）
3. ✅ 浏览器自动打开 http://localhost:3001
4. ✅ 可以继续使用，随时可关闭此窗口

**停止服务：**
```
双击 停止工具.bat
```

### Mac / Linux 用户

```bash
# 首次使用：安装依赖 + 启动
npm install && npm start

# 浏览器访问
open http://localhost:3001
```

### 手动启动（所有平台）

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Token（见下方）
cp .env.example .env   # 编辑 .env 填入你的 Token

# 3. 启动
npm start              # 或 npm run launcher （后台模式）
```

---

## ⚙️ 配置说明

### 获取 API Token

1. 访问 [兔子 API](https://api.tu-zi.com) 平台
2. 注册账号 → 登录控制台
3. 复制你的 API 密钥

### 配置 .env 文件

```bash
cp .env.example .env
# 编辑 .env，填入以下内容：
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `TUZI_API_TOKEN` | 你的兔子 API 密钥 | **必填** |
| `TUZI_API_BASE_URL` | API 地址 | `https://api.tu-zi.com/v1` |
| `PORT` | 服务端口 | `3001` |
| `POLL_INTERVAL` | 后端轮询间隔（毫秒） | `10000`（10秒） |
| `POLL_TIMEOUT` | 任务超时时间（毫秒） | `600000`（10分钟） |

> ⚠️ `.env` 文件包含密钥，**不要提交到 Git**（已在 .gitignore 中排除）

---

## 📖 使用指南

### 文生图

1. 打开浏览器访问 http://localhost:3001
2. 默认进入「文生图」页面
3. 输入详细描述（支持中英文，最多 2000 字符）
4. 点击 **生成图片**
5. 弹出「✓ 任务提交成功」→ 继续输入下一个提示词
6. 切换到「历史记录」查看进度和结果

**提示词示例：**
```
一只猪在草地上玩耍，动漫风格，
阳光明媚，蓝天白云，草地绿油油的，
可爱治愈系画风
```

### 图生图

1. 切换到「图生图」选项卡
2. 上传本地图片 **或** 粘贴图片 URL（多张换行分隔）
3. 输入修改描述（如："转为动漫风格"）
4. 点击 **生成图片**

### 历史记录管理

在「历史记录」选项卡可以：

| 操作 | 说明 |
|------|------|
| 👁 查看状态 | pending / completed / failed 实时显示 |
| 📥 下载 | 任务完成后点击下载按钮 |
| 🔁 重试 | 失败的任务点击重试重新提交 |
| 🗑 删除 | 单个删除或一键清空 |
| 🔍 放大 | 点击结果图片查看大图 |

### 连续批量提交

- 提交后**立即释放按钮**，无需等待返回
- 可以连续点击多次，每次都弹出成功提示
- 所有任务进入队列，在历史记录中跟踪状态
- 后台每 10 秒轮询一次 API 更新状态

---

## 📂 项目结构

```
image-generation-tool/
├── server/                  # 后端服务
│   ├── app.js               # Express 主程序 & API 路由
│   ├── db.js                # 数据库层（lowdb JSON 存储）
│   ├── launcher.js          # 后台启动器（隐藏窗口模式）
│   ├── api/
│   │   └── tuzi.js          # 兔子 API 封装（超时 600s）
│   └── jobs/
│       └── pollWorker.js    # 定时轮询任务状态
├── public/                  # 前端静态文件
│   ├── index.html           # 主页面（三选项卡布局）
│   ├── app.js               # 核心逻辑（队列/增量更新/弹窗）
│   └── styles.css           # 样式表
├── 启动工具.bat             # Windows 一键启动（推荐入口）
├── 停止工具.bat             # Windows 一键停止
├── start_hidden.vbs         # VBS 隐藏窗口启动器
├── 启动工具-无窗口.vbs       # 无窗口静默启动
├── package.json             # 项目配置 & 依赖
├── .gitignore               # Git 忽略规则
├── .env.example             # 环境变量模板
└── README.md                # 本文档
```

---

## 🔧 技术栈

| 层 | 技术 | 用途 |
|---|------|------|
| 前端 | Vanilla JS + HTML5 + CSS3 | 无框架，轻量快速 |
| 后端 | Node.js + Express | RESTful API 服务 |
| 存储 | lowdb (JSON file) | 本地任务数据库 |
| AI 模型 | 兔子 API (nano-banana-2) | 图片生成 |

---

## 🐛 常见问题

### Q: 启动后浏览器打不开？

确认端口是否被占用：
```bash
# 查看端口 3001 是否被使用
netstat -ano | findstr :3001

# 如被占用，修改 .env 中的 PORT=其他端口
```

### Q: 提示 "Failed to fetch"

1. 确认服务已正常启动（bat 没报错）
2. 确认浏览器地址的端口与 .env 中 PORT 一致
3. 双击「停止工具.bat」再双击「启动工具.bat」重启

### Q: 任务一直失败 / TLS 错误

- 确保网络可以访问 `api.tu-zi.com`（国内可能需要代理）
- 检查 API Token 是否有效且未过期
- 已设置 600 秒超时，基本够用

### Q: 如何修改端口？

编辑 `.env` 文件中的 `PORT=3001` 为你想要的端口号，然后重启服务。

---

## 📝 更新日志

### v1.1.0 (2026-04-10)
- ✅ 队列模式：提交即释放，连续提交不阻塞
- ✅ 成功弹窗：居中显示"任务提交成功"，2秒消失
- ✅ 增量刷新：历史记录数据不变时不重绘，防止抖动
- ✅ 后台运行：服务脱离终端窗口独立存活
- ✅ 超时延长：API 调用超时从 60s 提升到 600s
- ✅ 一键启停：bat 脚本启动 / 停止服务

### v1.0.0 (2026-04-08)
- ✅ 文生图 / 图生图基础功能
- ✅ 历史记录与任务管理
- ✅ 自动轮询更新状态
- ✅ 一键清空与重试

---

## 📜 许可证

[MIT License](LICENSE)

---

<p align="center">
 Made with ❤️ by <a href="https://github.com/Movie996">Movie996</a>
</p>
