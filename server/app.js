import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

import db from './db.js';
import { submitTask, retryTask } from './api/tuzi.js';
import { startPolling, stopPolling, pollOnce } from './jobs/pollWorker.js';

const __dirname_app = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname_app, '..', '.env');
dotenv.config({ path: envPath });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const app = express();

// 中间件
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 初始化数据库
async function initDb() {
  try {
    await db.init();
    console.log('✓ 数据库初始化成功');
  } catch (error) {
    console.error('✗ 数据库初始化失败:', error.message);
    process.exit(1);
  }
}

// ========== API 路由 ==========

/**
 * POST /api/generate
 * 提交文生图或图生图任务
 */
app.post('/api/generate', async (req, res) => {
  try {
    const { type, prompt, imageUrls } = req.body;

    // 参数验证
    if (!type || !prompt) {
      return res.status(400).json({ error: '缺少必要参数: type, prompt' });
    }

    if (type !== 'text2img' && type !== 'img2img') {
      return res.status(400).json({ error: 'type 必须是 "text2img" 或 "img2img"' });
    }

    if (type === 'img2img' && (!imageUrls || imageUrls.length === 0)) {
      return res.status(400).json({ error: '图生图任务必须提供图片 URL' });
    }

    if (prompt.length > 2000) {
      return res.status(400).json({ error: '提示词过长（最多 2000 字符）' });
    }

    console.log(`[API] 收到 ${type} 请求, 提示词: ${prompt.substring(0, 50)}...`);

    // 调用兔子 API（Token 来自环境变量，不需要前端传递）
    const apiResult = await submitTask(type, prompt, imageUrls || []);

    // 保存到数据库
    const dbTask = await db.createTask({
      taskId: apiResult.taskId,
      type,
      prompt,
      imageUrls: imageUrls || []
    });

    // 如果 API 直接返回了完成结果
    if (apiResult.status === 'completed' && apiResult.resultUrl) {
      await db.updateTask(apiResult.taskId, {
        status: 'completed',
        resultUrl: apiResult.resultUrl
      });
      return res.json({
        taskId: apiResult.taskId,
        status: 'completed',
        resultUrl: apiResult.resultUrl,
        message: '任务已完成'
      });
    }

    // 否则返回待处理状态
    res.json({
      taskId: apiResult.taskId,
      status: 'pending',
      message: '任务已提交，请等待处理...'
    });
  } catch (error) {
    console.error('[API] 错误:', error.message);
    res.status(500).json({
      error: error.message || '请求失败'
    });
  }
});

/**
 * GET /api/status/:taskId
 * 查询任务状态
 */
app.get('/api/status/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const task = db.getTask(taskId);

    if (!task) {
      return res.status(404).json({ error: '任务未找到' });
    }

    res.json({
      taskId: task.taskId,
      type: task.type,
      status: task.status,
      resultUrl: task.resultUrl,
      errorMessage: task.errorMessage,
      prompt: task.prompt,
      imageUrls: task.imageUrls,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    });
  } catch (error) {
    console.error('[API] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/history
 * 获取历史记录
 */
app.get('/api/history', (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const offset = (page - 1) * limit;

    const history = db.getHistory(limit, offset);

    res.json({
      total: history.total,
      page: history.page,
      limit: history.limit,
      items: history.items
    });
  } catch (error) {
    console.error('[API] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/retry/:taskId
 * 重新提交失败的任务
 */
app.post('/api/retry/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = db.getTask(taskId);

    if (!task) {
      return res.status(404).json({ error: '任务未找到' });
    }

    if (task.status === 'pending') {
      return res.status(400).json({ error: '任务仍在处理中，无需重试' });
    }

    console.log(`[API] 重试任务 ${taskId}...`);

    // 调用兔子 API
    const apiResult = await retryTask(task.type, task.prompt, task.imageUrls);

    // 更新任务
    await db.updateTask(task.taskId, {
      status: 'pending',
      resultUrl: null,
      errorMessage: null
    });

    res.json({
      taskId: apiResult.taskId,
      status: 'pending',
      message: '任务已重新提交'
    });
  } catch (error) {
    console.error('[API] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/task/:taskId
 * 删除任务记录
 */
app.delete('/api/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const deleted = await db.deleteTask(taskId);

    if (!deleted) {
      return res.status(404).json({ error: '任务未找到' });
    }

    res.json({ message: '任务已删除' });
  } catch (error) {
    console.error('[API] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/poll-once
 * 手动触发一次轮询（调试用）
 */
app.post('/api/poll-once', async (req, res) => {
  try {
    await pollOnce();
    res.json({ message: '轮询已执行' });
  } catch (error) {
    console.error('[API] 错误:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== 服务器启动 ==========

// 自动打开浏览器
function openBrowser(url) {
  const platform = process.platform;
  let command;

  if (platform === 'win32') {
    command = `start ${url}`;
  } else if (platform === 'darwin') {
    command = `open ${url}`;
  } else {
    command = `xdg-open ${url}`;
  }

  exec(command, (error) => {
    if (error) {
      console.log(`请手动打开浏览器访问: ${url}`);
    }
  });
}

async function startServer() {
  try {
    // 初始化数据库
    await initDb();

    // 启动轮询
    startPolling();

    // 启动服务器
    const server = app.listen(PORT, () => {
      const url = `http://localhost:${PORT}`;
      console.log(`\n✓ 服务器运行中: ${url}`);
      console.log(`✓ 轮询间隔: ${process.env.POLL_INTERVAL || 30000}ms`);
      console.log(`✓ 浏览器将自动打开...`);
      console.log(`\n[提示] 关闭浏览器后，请按 Ctrl+C 停止服务器\n`);

      // 延迟 1 秒后打开浏览器
      setTimeout(() => {
        openBrowser(url);
      }, 1000);
    });

    // 优雅关闭
    const shutdown = () => {
      console.log('\n正在关闭服务器...');
      stopPolling();
      server.close(() => {
        console.log('✓ 服务器已关闭');
        process.exit(0);
      });

      // 5秒后强制关闭
      setTimeout(() => {
        console.log('强制关闭...');
        process.exit(1);
      }, 5000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('启动失败:', error.message);
    process.exit(1);
  }
}

startServer();
