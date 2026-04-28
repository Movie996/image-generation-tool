# 图器 3.0 API 接口文档

## 项目概述

图器 3.0 是一个基于 Node.js + Express 的图片生成工具，集成 **Tu-Zi (兔子) API**，支持双模型：
- **Banana-2** (`nano-banana-2`) — 快速生图，返回 URL 格式
- **GPT Image-2** (`gpt-image-2`) — 高清生图，返回 Base64 并自动保存到本地

---

## 环境变量配置 (.env)

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `TUZI_API_TOKEN` | ✅ | Banana-2 模型的 API 密钥（`sk-xxx`）|
| `TUZI_IMAGE2_TOKEN` | ❌ | GPT Image-2 模型的专用密钥（不配置则 image-2 不可用）|
| `TUZI_API_BASE_URL` | ❌ | Tu-Zi API 基础地址（默认 `https://api.tu-zi.com/v1`）|
| `PORT` | ❌ | 服务端口（默认 3001）|

### .env 示例

```bash
# Banana-2 密钥（默认模型）
TUZI_API_TOKEN="sk-fE95j1Ehx6xhzsftOphrWKx6HvjDbeDs5j9ZaBTkw1QNdEK9"

# GPT Image-2 专用密钥
TUZI_IMAGE2_TOKEN="sk-LaJyzeOHg4hGlSfOd6Pmqopntk19eHIZIStcROTC5DZef3tX"
```

---

## API 接口列表

### POST /api/generate — 提交图片生成任务

提交文生图或图生图任务，支持选择不同模型。

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 任务类型：`text2img`（文生图）或 `img2img`（图生图）|
| `prompt` | string | ✅ | 图片生成提示词 |
| `model` | string | ❌ | 模型名称。默认 `nano-banana-2`，可选 `gpt-image-2` |
| `imageUrls` | string[] | ❌ | 参考图 URL 列表（仅 img2img 时需要）|

#### 请求示例

```json
// 文生图 - Banana-2
{
  "type": "text2img",
  "prompt": "一只橘猫坐在窗台上",
  "model": "nano-banana-2"
}

// 图生图 - GPT Image-2
{
  "type": "img2img",
  "prompt": "基于参考图的定制抱枕",
  "model": "gpt-image-2",
  "imageUrls": ["https://example.com/ref.png"]
}
```

#### 成功响应

```json
// Banana-2 返回（URL 格式）
{
  "taskId": "1714234567890",
  "status": "completed",
  "resultUrl": "https://oss.blueshirtmap.com/xxx.png",
  "format": "url",
  "isLocal": false,
  "message": "任务已完成"
}

// GPT Image-2 返回（Base64 已保存本地）
{
  "taskId": "1714234567891",
  "status": "completed",
  "resultUrl": "/generated-output/1714234567891.png",
  "format": "base64",
  "isLocal": true,
  "message": "任务已完成 (Base64已保存到本地)"
}

// 任务待处理（极少出现）
{
  "taskId": "1714234567892",
  "status": "pending",
  "message": "任务已提交，请等待处理..."
}
```

#### 错误响应

```json
{ "error": "缺少必要参数: type, prompt" }
{ "error": "API 调用失败: HTTP Error 500: ..." }
{ "error": "TUZI_IMAGE2_TOKEN 未配置" }
```

---

### GET /api/status/:taskId — 查询任务状态

#### 响应示例

```json
{
  "taskId": "1714234567890",
  "type": "text2img",
  "status": "completed",
  "resultUrl": "/generated-output/1714234567890.png",
  "errorMessage": null,
  "prompt": "一只橘猫坐在窗台上",
  "imageUrls": [],
  "metadata": {
    "model": "gpt-image-2",
    "format": "base64"
  },
  "createdAt": "2026-04-27T09:30:00.000Z",
  "updatedAt": "2026-04-27T09:31:42.000Z"
}
```

---

### GET /api/history — 获取历史记录

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | int | 1 | 页码 |
| `limit` | int | 20 | 每页条数 |

---

### DELETE /api/task/:taskId — 删除任务记录

### POST /api/retry/:taskId — 重试失败的任务

### GET /api/proxy-image?url=xxx — 图片代理（解决跨域/防盗链）

---

## 双模型差异对照

| 特性 | Banana-2 (`nano-banana-2`) | GPT Image-2 (`gpt-image-2`) |
|------|---------------------------|-------------------------------|
| **密钥** | `TUZI_API_TOKEN` | `TUZI_IMAGE2_TOKEN` |
| **返回格式** | URL（OSS 链接）| Base64 → 自动保存为本地 PNG |
| **结果路径** | 外部 HTTPS URL | `/generated-output/{taskId}.png` |
| **尺寸** | 1440×2560 | 1440×2560 |
| **速度** | 较快 (~60s) | 较慢 (~140s) |
| **内容审核** | 宽松 | 严格（人物/敏感词易被拒）|
| **前端展示** | 走 proxyImage 代理 | 本地静态文件直出，无需代理 |

---

## Base64 本地存储说明

当使用 `gpt-image-2` 模型时：

1. 后端请求 API 时设置 `response_format: b64_json`
2. 收到 base64 数据后解码为 Buffer
3. 写入 `public/generated-output/{taskId}.png`
4. 前端通过 `/generated-output/{taskId}.png` 直接访问（Express static 中间件已覆盖 public 目录）

> ⚠️ 生成的图片会持续累积在 `public/generated-output/` 目录中，如需清理可手动删除。

---

## 启动项目

```bash
# 安装依赖
npm install

# 配置环境变量（复制示例并修改）
cp .env.example .env
# 编辑 .env 填入你的密钥

# 启动服务
npm start

# 浏览器访问 http://localhost:3001
```
