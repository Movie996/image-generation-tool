import { Low, JSONFile } from 'lowdb';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'db.json');

// 确保 data 目录存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 默认数据结构
const defaultData = {
  tasks: []
};

class Database {
  constructor() {
    this.db = null;
  }

  async init() {
    const adapter = new JSONFile(dbPath);
    this.db = new Low(adapter, defaultData);
    await this.db.read();

    // 确保初始化为正确的数据结构
    if (!this.db.data) {
      this.db.data = defaultData;
    }
    if (!this.db.data.tasks) {
      this.db.data.tasks = [];
    }

    // 写入初始化数据
    await this.db.write();
  }

  // 创建新任务
  async createTask(data) {
    const task = {
      id: Date.now().toString(),
      taskId: data.taskId || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: data.type, // "text2img" | "img2img" | "gridsplit"
      prompt: data.prompt || '',
      imageUrls: data.imageUrls || [],
      status: data.status || 'pending', // 允许外部指定状态
      resultUrl: data.resultUrl || null,
      errorMessage: data.errorMessage || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 合并扩展字段（isLocal, metadata, gridImages 等）
    const extFields = ['isLocal', 'metadata', 'gridImages'];
    for (const key of extFields) {
      if (data[key] !== undefined) {
        task[key] = data[key];
      }
    }

    this.db.data.tasks.push(task);
    await this.db.write();
    return task;
  }

  // 获取任务
  getTask(taskId) {
    if (!this.db || !this.db.data) return null;
    return this.db.data.tasks.find(t => t.taskId === taskId);
  }

  // 更新任务状态
  async updateTask(taskId, updates) {
    const task = this.getTask(taskId);
    if (task) {
      Object.assign(task, updates, { updatedAt: new Date().toISOString() });
      await this.db.write();
      return task;
    }
    return null;
  }

  // 获取所有待处理任务
  getPendingTasks() {
    if (!this.db || !this.db.data) return [];
    return this.db.data.tasks.filter(t => t.status === 'pending');
  }

  // 获取历史记录
  getHistory(limit = 20, offset = 0) {
    if (!this.db || !this.db.data) {
      return {
        total: 0,
        items: [],
        page: 1,
        limit
      };
    }

    const sorted = [...this.db.data.tasks].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    return {
      total: sorted.length,
      items: sorted.slice(offset, offset + limit),
      page: Math.floor(offset / limit) + 1,
      limit
    };
  }

  // 删除任务（支持通过 id 或 taskId 删除，兼容历史 undefined taskId）
  async deleteTask(id) {
    if (!this.db || !this.db.data) return null;

    // 先精确匹配 taskId，再 fallback 匹配内部 id
    const index = this.db.data.tasks.findIndex(
      t => t.taskId === id || t.id === id
    );
    
    if (index > -1) {
      const deleted = this.db.data.tasks.splice(index, 1);
      console.log(`[DB] 已删除: ${deleted[0]?.taskId || deleted[0]?.id} (${deleted[0]?.type})`);
      await this.db.write();
      return deleted[0];
    }
    
    console.log(`[DB] 未找到任务: ${id}, 当前共 ${this.db.data.tasks.length} 条记录`);
    return null;
  }

  // 获取所有任务
  getAllTasks() {
    if (!this.db || !this.db.data) return [];
    return this.db.data.tasks;
  }
}

const db = new Database();

export default db;

