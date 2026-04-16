/**
 * 宫格拆分 API 路由（异步队列模式）
 * =====================================
 * POST /api/split-grid  → 立即创建任务入库，后台跑 Python，完成后更新结果
 * GET /api/task/:taskId  → 查询任务状态（复用现有接口）
 * 前端通过轮询获取状态更新
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import db from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Python 桥接脚本路径
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'grid_split_bridge.py');
// 输出根目录 — 必须在项目 public/ 下（Express 静态文件服务从这里提供文件）
const OUTPUT_ROOT = path.join(__dirname, '..', '..', 'public', 'grid-output');

/**
 * 运行中的任务映射表
 * taskId → { proc: ChildProcess, cleanup: Function }
 * 用于跟踪所有活跃的宫格拆分进程
 */
const runningTasks = new Map();

/**
 * POST /api/split-grid（异步模式）
 *
 * Body:
 *   - image: 图片源（base64 编码的文件内容 + 文件名，或 URL 字符串）
 *   - gridType: 网格类型 "4" | "9"（默认 "4"）
 *   - imageType: "file" | "url"（默认 "file"）
 *
 * 返回：{ taskId, message }
 * 任务立即以 pending 状态入库，Python 在后台执行
 */
router.post('/split-grid', async (req, res) => {
  try {
    const { image, gridType = '4', imageType = 'file' } = req.body;

    if (!image) {
      return res.json({ success: false, error: '请提供图片' });
    }

    if (!['4', '9'].includes(String(gridType))) {
      return res.json({ success: false, error: '仅支持四宫格和九宫格' });
    }

    // ── 第一步：准备参数 ──
    let imageSource;
    let tempFileToDelete = null; // 用于清理临时文件

    if (imageType === 'url') {
      imageSource = image.trim();
      if (!imageSource.startsWith('http://') && !imageSource.startsWith('https://')) {
        return res.json({ success: false, error: '无效的图片 URL' });
      }
    } else {
      try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = detectImageExtension(base64Data);
        const tempDir = path.join(OUTPUT_ROOT, 'temp');
        fs.mkdirSync(tempDir, { recursive: true });
        imageSource = path.join(tempDir, `input_${Date.now()}${ext}`);
        fs.writeFileSync(imageSource, buffer);
        tempFileToDelete = imageSource;
      } catch (err) {
        return res.json({ success: false, error: `图片解析失败: ${err.message}` });
      }
    }

    // ── 第二步：立即创建任务记录 ──
    const batchId = Date.now().toString(36).toUpperCase();
    const outputDir = path.join(OUTPUT_ROOT, batchId);
    const taskId = `grid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const promptText = imageType === 'url'
      ? `[URL] ${image.substring(0, 80)}${image.length > 80 ? '...' : ''}`
      : '[本地上传]';

    const task = await db.createTask({
      taskId,
      type: 'gridsplit',
      prompt: promptText,
      imageUrls: [image],
      status: 'pending',
      isLocal: true,
      metadata: JSON.stringify({
        gridType,
        imageType,
        batchId,
        outputDir,
        originalImage: imageType === 'url' ? image : null,
      }),
    });

    console.log(`[Grid Split] 📋 任务已创建 #${taskId} (batch: ${batchId}, type: ${gridType}x${gridType})`);

    // ── 第三步：立即响应前端 ──
    res.json({ taskId, message: '任务已提交，正在处理中...', status: 'pending' });

    // ── 第四步：后台异步执行 Python ──
    executePythonAsync(taskId, imageSource, String(gridType), outputDir, batchId,
      tempFileToDelete, db, req.app.locals);

  } catch (error) {
    console.error('[Grid Split] 创建任务失败:', error.message);
    res.status(500).json({ success: false, error: error.message || '服务器内部错误' });
  }
});

/**
 * 异步执行 Python 脚本
 * 在后台运行，完成后自动更新数据库
 */
function executePythonAsync(taskId, imageSource, gridType, outputDir, batchId,
                           tempFile, db, locals) {
  const args = [
    SCRIPT_PATH,
    '--image', imageSource,
    '--grid-type', gridType,
    '--output-dir', outputDir,
  ];

  console.log(`[Grid Split] ▶ 启动 Python 进程 #${taskId}: python ${args.join(' ')}`);

  const proc = spawn('python', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';

  // 注册到运行中任务列表
  runningTasks.set(taskId, { proc });

  proc.stdout.on('data', (data) => { stdout += data.toString(); });
  proc.stderr.on('data', (data) => {
    stderr += data.toString();
    process.stderr.write(`[GS#${taskId}] ${data}`);
  });

  proc.on('close', async (code) => {
    runningTasks.delete(taskId);

    // 清理临时文件
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
    }

    if (code !== 0) {
      const errMsg = stderr.length > 300 ? stderr.substring(0, 300) + '...' : stderr;
      console.error(`[Grid Split] ❌ #${taskId} 进程退出 code=${code}:`, errMsg);
      try {
        await db.updateTask(taskId, {
          status: 'failed',
          errorMessage: `Python 错误(code ${code}): ${errMsg}`,
        });
      } catch (e) {
        console.error(`[Grid Split] 更新失败状态失败 #${taskId}:`, e.message);
      }
      return;
    }

    // 解析成功结果
    try {
      const result = JSON.parse(stdout);
      if (!result.success || !result.images?.length) {
        throw new Error(result?.error || '无输出图片');
      }

      // 使用本地文件路径（Python 已下载到 outputDir）
      const gridImages = result.images
        .filter(img => img.localPath)
        .map((img, i) => ({
          index: img.index ?? i,
          filename: img.filename || `grid_${String(i).padStart(2, '0')}.jpg`,
          localPath: img.localPath,
          // 前端通过 Express 静态文件服务访问
          url: `/grid-output/${batchId}/${img.filename}`,
        }));

      // 更新数据库为 completed
      await db.updateTask(taskId, {
        status: 'completed',
        resultUrl: gridImages[0]?.url || null,
        errorMessage: null,
        gridImages: JSON.stringify(gridImages),
        metadata: JSON.stringify({
          gridType,
          imageType: gridType === '4' ? '四宫格(2×2)' : '九宫格(3×3)',
          batchId,
          fileCount: gridImages.length,
          outputDir,           // 完整的本地文件夹绝对路径
          source: 'local_file',
        }),
      });

      console.log(`[Grid Split] ✅ #${taskId} 完成! ${gridImages.length} 张图 → ${outputDir}`);

    } catch (parseError) {
      console.error(`[Grid Split] ❌ #${taskId} 结果解析失败:`, parseError.message);
      try {
        await db.updateTask(taskId, {
          status: 'failed',
          errorMessage: `结果解析失败: ${parseError.message}`,
        });
      } catch (e) { /* ignore */ }
    }
  });

  proc.on('error', async (err) => {
    runningTasks.delete(taskId);
    console.error(`[Grid Split] 💀 #${taskId} 启动失败:`, err.message);
    try {
      await db.updateTask(taskId, {
        status: 'failed',
        errorMessage: `Python 启动失败: ${err.message}`,
      });
    } catch (e) { /* ignore */ }
  });

  // 手动超时：6 分钟强制 kill
  setTimeout(() => {
    if (runningTasks.has(taskId)) {
      console.error(`[Grid Split] ⏰ #${taskId} 超时(6min)，终止中...`);
      try { proc.kill('SIGKILL'); } catch (_) {}
    }
  }, 6 * 60 * 1000);
}

/**
 * GET /api/split-grid/status/:taskId
 * 快速查询宫格拆分任务是否还在运行中
 */
router.get('/split-grid/status/:taskId', (req, res) => {
  const { taskId } = req.params;
  const running = runningTasks.has(taskId);
  res.json({ running, taskId });
});

/**
 * GET /api/split-grid/batches
 * 获取所有已完成的拆分批次列表（保留）
 */
router.get('/split-grid/batches', (req, res) => {
  try {
    if (!fs.existsSync(OUTPUT_ROOT)) {
      return res.json({ success: true, batches: [] });
    }

    const dirs = fs.readdirSync(OUTPUT_ROOT)
      .filter(name => name !== 'temp')
      .filter(name => fs.statSync(path.join(OUTPUT_ROOT, name)).isDirectory())
      .map(name => ({
        batchId: name,
        fileCount: (fs.readdirSync(path.join(OUTPUT_ROOT, name)) || []).filter(f => f.startsWith('grid_')).length,
        createdAt: fs.statSync(path.join(OUTPUT_ROOT, name)).mtime.toISOString(),
        previewUrl: `/grid-output/${name}`,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, batches: dirs });

  } catch (error) {
    console.error('[List Batches Error]', error);
    res.json({ success: false, error: error.message });
  }
});

// ──────────────── 辅助函数 ────────────────

function detectImageExtension(base64Data) {
  const signatures = { '/9j/': '.jpg', 'iVBOR': '.png', 'R0lGO': '.gif', 'UklGR': '.webp', 'AAABA': '.bmp' };
  for (const [sig, ext] of Object.entries(signatures)) {
    if (base64Data.startsWith(sig)) return ext;
  }
  return '.jpg';
}

export default router;
