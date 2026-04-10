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
      taskId: data.taskId,
      type: data.type, // "text2img" 或 "img2img"
      prompt: data.prompt,
      imageUrls: data.imageUrls || [],
      status: 'pending', // "pending" | "completed" | "failed"
      resultUrl: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

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

  // 删除任务
  async deleteTask(taskId) {
    if (!this.db || !this.db.data) return null;

    const index = this.db.data.tasks.findIndex(t => t.taskId === taskId);
    if (index > -1) {
      const deleted = this.db.data.tasks.splice(index, 1);
      await this.db.write();
      return deleted[0];
    }
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

