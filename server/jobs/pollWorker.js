import db from '../db.js';
import { checkTaskStatus } from '../api/tuzi.js';

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '10000', 10); // 默认 10 秒
const POLL_TIMEOUT = parseInt(process.env.POLL_TIMEOUT || '600000', 10); // 默认 10 分钟

let pollTimer = null;

/**
 * 轮询待处理任务
 */
async function pollPendingTasks() {
  try {
    const pendingTasks = db.getPendingTasks();

    if (pendingTasks.length === 0) {
      return;
    }

    console.log(`[Poll Worker] 检查 ${pendingTasks.length} 个待处理任务...`);

    for (const task of pendingTasks) {
      try {
        // 跳过非兔子 API 任务（宫格拆分由 gridSplit.js 自己管理）
        if (task.type === 'gridsplit' || task.isLocal) {
          continue;
        }

        // 检查任务是否超时
        const createdAt = new Date(task.createdAt);
        const now = new Date();
        const elapsedTime = now - createdAt;

        if (elapsedTime > POLL_TIMEOUT) {
          // 任务超时，标记为失败
          await db.updateTask(task.taskId, {
            status: 'failed',
            errorMessage: '任务超时（10分钟未获得结果）'
          });
          console.log(`[Poll Worker] 任务 ${task.taskId} 已超时`);
          continue;
        }

        // 查询任务状态
        const status = await checkTaskStatus(task.taskId);

        if (status.status === 'completed' && status.resultUrl) {
          // 任务完成
          await db.updateTask(task.taskId, {
            status: 'completed',
            resultUrl: status.resultUrl
          });
          console.log(`[Poll Worker] 任务 ${task.taskId} 已完成`);
        } else if (status.status === 'failed') {
          // 任务失败
          await db.updateTask(task.taskId, {
            status: 'failed',
            errorMessage: status.errorMessage || '任务处理失败'
          });
          console.log(`[Poll Worker] 任务 ${task.taskId} 失败`);
        }
        // 否则继续等待（status === 'pending'）
      } catch (error) {
        console.error(`[Poll Worker] 处理任务 ${task.taskId} 时出错:`, error.message);
        // 继续处理下一个任务，不中断轮询
      }
    }
  } catch (error) {
    console.error('[Poll Worker] 轮询过程中出错:', error.message);
  }
}

/**
 * 启动轮询
 */
export async function startPolling() {
  // 确保数据库已初始化
  if (!db.db) {
    await db.init();
  }

  console.log(`[Poll Worker] 启动轮询，间隔: ${POLL_INTERVAL}ms`);

  // 立即执行一次
  await pollPendingTasks();

  // 定期执行
  pollTimer = setInterval(pollPendingTasks, POLL_INTERVAL);
}

/**
 * 停止轮询
 */
export function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    console.log('[Poll Worker] 轮询已停止');
  }
}

/**
 * 手动触发一次轮询（用于调试）
 */
export async function pollOnce() {
  if (!db.db) {
    await db.init();
  }
  return pollPendingTasks();
}
