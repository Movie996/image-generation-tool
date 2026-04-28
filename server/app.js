import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import https from 'https';
import http from 'http';

import db from './db.js';
import { submitTask, retryTask } from './api/tuzi.js';
import { startPolling, stopPolling, pollOnce } from './jobs/pollWorker.js';
import gridSplitRouter from './routes/gridSplit.js';

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

// 宫格拆分路由
app.use('/api', gridSplitRouter);

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
    const { type, prompt, imageUrls, model } = req.body;

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

    // model 参数：支持 'nano-banana-2' 和 'gpt-image-2'，默认 banana-2
    const selectedModel = model || 'nano-banana-2';
    console.log(`[API] 收到 ${type} 请求 | model=${selectedModel} | 提示词: ${prompt.substring(0, 50)}...`);

    // 调用兔子 API（传入 model 参数）
    const apiResult = await submitTask(type, prompt, imageUrls || [], selectedModel);

    // 保存到数据库（记录 model 信息到 metadata）
    const dbTask = await db.createTask({
      taskId: apiResult.taskId,
      type,
      prompt,
      imageUrls: imageUrls || [],
      metadata: { model: selectedModel, format: apiResult.format || 'url' }
    });

    // 如果 API 直接返回了完成结果
    if (apiResult.status === 'completed' && apiResult.resultUrl) {
      const updateData = {
        status: 'completed',
        resultUrl: apiResult.resultUrl,
        // 同时将原始 URL 和格式信息存入数据库（供历史记录展示）
        metadata: { 
          model: selectedModel, 
          format: apiResult.format || 'url',
          originalUrl: apiResult.originalUrl || null 
        }
      };
      
      // 如果有独立的 originalUrl 字段也存一份（metadata 里有，但字段级更方便查询）
      // 注意：lowdb 的 schema 是灵活的，直接加字段即可
      if (apiResult.originalUrl) {
        updateData.originalUrl = apiResult.originalUrl;
      }

      await db.updateTask(apiResult.taskId, updateData);

      // 判断是否为本地路径（base64 模式下保存在本地）
      const isLocalPath = apiResult.resultUrl.startsWith('/generated-output/') 
                       || apiResult.resultUrl.startsWith('/grid-output/');

      return res.json({
        taskId: apiResult.taskId,
        status: 'completed',
        resultUrl: apiResult.resultUrl,          // 本地展示路径（优先）
        originalUrl: apiResult.originalUrl || null, // 原始远程 URL（供复制）
        format: apiResult.format || 'url',
        isLocal: isLocalPath,
        message: apiResult.message
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
      originalUrl: task.originalUrl || null,  // 原始远程 URL
      errorMessage: task.errorMessage,
      prompt: task.prompt,
      imageUrls: task.imageUrls,
      metadata: task.metadata || {},
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
 * POST /api/history
 * 手动添加历史记录（如宫格拆分完成后写入）
 */
app.post('/api/history', async (req, res) => {
  try {
    const { type, prompt, status, resultUrl, gridImages, metadata } = req.body;

    const task = await db.createTask({
      taskId: `grid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: type || 'gridsplit',
      prompt: prompt || '',
      imageUrls: [],
      status: status || 'completed',
      resultUrl: resultUrl || null,
      errorMessage: null,
      gridImages: gridImages || [], // 宫格拆分的子图片数组
      metadata: metadata || {}     // 额外元数据（耗时、输出目录等）
    });

    res.json({ success: true, taskId: task.taskId });
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

    // 从任务的 metadata 中获取 model，默认 nano-banana-2
    const taskModel = (task.metadata && task.metadata.model) || 'nano-banana-2';
    
    // 调用兔子 API（传递 model）
    const apiResult = await retryTask(task.type, task.prompt, task.imageUrls, taskModel);

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
 * 删除任务记录 + 清理本地存储的图片文件
 */
app.delete('/api/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    console.log(`[API] DELETE /api/task/${taskId} — 收到删除请求`);

    if (!db || !db.db) {
      console.error('[API] 数据库未初始化');
      return res.status(500).json({ error: '数据库未初始化' });
    }

    // 先获取完整任务信息（用于后续清理本地文件）
    const deleted = await db.deleteTask(taskId);

    if (!deleted) {
      console.warn(`[API] 任务 ${taskId} 未找到`);
      return res.status(404).json({ error: '任务未找到' });
    }

    console.log(`[API] 任务 ${taskId} 已从数据库删除 (type=${deleted.type}, status=${deleted.status})`);

    // ===== 清理本地存储的图片文件 =====
    let cleanedFiles = [];
    
    try {
      // 清理 resultUrl 对应的本地文件（如果存在）
      if (deleted.resultUrl) {
        const urlToDelete = deleted.resultUrl;
        
        if (urlToDelete.startsWith('/generated-output/') || urlToDelete.startsWith('/grid-output/')) {
          // 本地路径：解析为绝对路径并删除
          const publicDir = path.join(__dirname, '..', 'public');
          const absolutePath = path.resolve(publicDir, '.' + urlToDelete);
          
          if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
            cleanedFiles.push(urlToDelete);
            console.log(`[API] 已清理本地文件: ${absolutePath}`);
          } else {
            console.log(`[API] 本地文件不存在(已提前清理): ${absolutePath}`);
          }
        }
        // 远程 URL 不需要清理（不在本地磁盘上）
      }

      // 如果有 originalUrl 指向的本地文件也清理（理论上和 resultUrl 是同一张图）
      if (deleted.originalUrl && deleted.originalUrl !== deleted.resultUrl) {
        if (deleted.originalUrl.startsWith('/generated-output/') || deleted.originalUrl.startsWith('/grid-output/')) {
          const publicDir = path.join(__dirname, '..', 'public');
          const absPath = path.resolve(publicDir, '.' + deleted.originalUrl);
          if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath);
            cleanedFiles.push(deleted.originalUrl);
            console.log(`[API] 已清理 originalUrl 本地文件: ${absPath}`);
          }
        }
      }

      // 宫格拆分：清理 gridImages 中的所有本地子图
      if (deleted.gridImages) {
        let gridImgList = deleted.gridImages;
        if (typeof gridImgList === 'string') {
          try { gridImgList = JSON.parse(gridImgList); } catch(_) { gridImgList = []; }
        }
        if (Array.isArray(gridImgList)) {
          for (const img of gridImgList) {
            const imgUrl = (img && img.url) || img;
            if (typeof imgUrl === 'string' && (
              imgUrl.startsWith('/grid-output/') || 
              imgUrl.startsWith('/generated-output/')
            )) {
              const publicDir = path.join(__dirname, '..', 'public');
              const absPath = path.resolve(publicDir, '.' + imgUrl);
              if (fs.existsSync(absPath)) {
                fs.unlinkSync(absPath);
                cleanedFiles.push(imgUrl);
              }
            }
          }
        }
      }
    } catch (cleanErr) {
      // 文件清理失败不影响删除操作的结果，只记录日志
      console.error(`[API] 清理本地文件时出错（不影响删除结果）: ${cleanErr.message}`);
    }

    console.log(`[API] 任务 ${taskId} 删除完成 | 已清理 ${cleanedFiles.length} 个本地文件`);
    res.json({ 
      message: '任务已删除', 
      cleanedFiles 
    });
  } catch (error) {
    console.error(`[API] 删除任务失败:`, error);
    res.status(500).json({ error: `删除失败: ${error.message}` });
  }
});

/**
 * GET /api/proxy-image?url=<encoded_url>
 * 图片代理接口：使用原生 https/http 模块中转外部图片
 */
app.get('/api/proxy-image', (req, res) => {
  let targetUrl;
  try {
    targetUrl = decodeURIComponent(req.query.url);
  } catch (_) {
    return res.status(400).json({ error: 'URL 解码失败' });
  }

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: '无效的 URL 参数' });
  }

  console.log(`[Proxy] 代理图片: ${targetUrl.substring(0, 100)}...`);

  const useHttp = targetUrl.startsWith('http://');
  const client = useHttp ? http : https;

  const reqOptions = new URL(targetUrl);
  Object.assign(reqOptions, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',  // 不压缩，避免解压问题
    },
    timeout: 30000,
  });

  const proxyReq = client.request(reqOptions, (proxyRes) => {
    // 上游错误直接透传状态码
    if (proxyRes.statusCode >= 400) {
      console.error(`[Proxy] 上游返回 ${proxyRes.statusCode} for ${targetUrl.substring(0, 60)}`);
      return res.status(proxyRes.status || 502).send(`上游返回 ${proxyRes.statusCode}`);
    }

    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.setHeader('X-Proxy-Source', 'true');
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    console.error('[Proxy] 请求超时:', targetUrl.substring(0, 60));
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).send({ error: '图片加载超时' });
  });

  proxyReq.on('error', (err) => {
    console.error('[Proxy] 代理失败:', err.message, '| 目标:', targetUrl.substring(0, 60));
    if (!res.headersSent) {
      res.status(502).json({ error: `代理失败: ${err.message}` });
    }
  });

  proxyReq.end();
});

/**
 * GET /api/base-info
 * 返回公共目录的绝对路径（供前端拼接完整本地路径）
 */
app.get('/api/base-info', (req, res) => {
  const publicDir = path.resolve(path.join(__dirname, '..', 'public'));
  res.json({ publicDir });
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
