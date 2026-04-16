// ========== 配置 ==========
const API_BASE = '/api';
const AUTO_REFRESH_INTERVAL = 2000; // 2秒自动刷新历史记录

/**
 * 将外部图片 URL 转为本地代理 URL
 * 解决 CORS / 签名过期 / 防盗链等问题（COS 私有桶、兔子 API 等都适用）
 * @param {string} url - 原始图片 URL
 * @returns {string} 代理后的本地 URL
 */
function proxyUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('/') && !url.startsWith('//')) return url; // 已经是本地路径
  return `${API_BASE}/proxy-image?url=${encodeURIComponent(url)}`;
}

// 自定义错误类，携带服务端返回的原始数据
class ResultError extends Error {
  constructor(message, data) {
    super(message);
    this.name = 'ResultError';
    this.data = data;
  }
}

// ========== DOM 选择 ==========
const statusIndicator = document.getElementById('statusIndicator');
const taskCounter = document.getElementById('taskCounter');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const text2imgForm = document.getElementById('text2imgForm');
const text2imgPrompt = document.getElementById('text2imgPrompt');
const text2imgCount = document.getElementById('text2imgCount');

const img2imgForm = document.getElementById('img2imgForm');
const img2imgUrls = document.getElementById('img2imgUrls');
const img2imgPrompt = document.getElementById('img2imgPrompt');
const img2imgCount = document.getElementById('img2imgCount');
const img2imgFileInput = document.getElementById('img2imgFile');
const img2imgFilePreview = document.getElementById('img2imgFilePreview');

const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const historyContent = document.getElementById('historyContent');

// 图片预览模态框
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const closeModal = document.getElementById('closeModal');

// ========== 全局状态 ==========
let autoRefreshTimer = null;
let isHistoryVisible = false;
let uploadedImagesBase64 = []; // 支持多图上传

// 本地任务队列（提交中的任务）
let localTaskQueue = [];

// 历史记录增量更新缓存（防止整块刷新导致闪烁）
let lastRenderedTasks = null; // 上次渲染时的任务快照 { taskId: {status, resultUrl} }

// ========== 连接状态检查 ==========
async function checkServerStatus() {
  try {
    const response = await fetch(`${API_BASE}/history?page=1&limit=1`);
    if (response.ok) {
      statusIndicator.textContent = '● 已连接';
      statusIndicator.className = 'status-indicator online';
      return true;
    }
  } catch (error) {
    statusIndicator.textContent = '● 连接中...';
    statusIndicator.className = 'status-indicator offline';
    return false;
  }
}

setInterval(checkServerStatus, 30000);
checkServerStatus();

// ========== 更新任务计数器 ==========
function updateTaskCounter() {
  taskCounter.textContent = `当前任务: ${localTaskQueue.length}`;

  if (localTaskQueue.length > 0) {
    taskCounter.className = 'task-counter active';
  } else {
    taskCounter.className = 'task-counter';
  }
}

// ========== 选项卡切换 ==========
function initTabs() {
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  tabPanes.forEach(pane => {
    pane.classList.toggle('active', pane.id === tabName);
  });

  if (tabName === 'history') {
    isHistoryVisible = true;
    loadHistory();
  } else {
    isHistoryVisible = false;
  }
}

// ========== 全局自动刷新 ==========
function startGlobalAutoRefresh() {
  if (autoRefreshTimer) return;

  autoRefreshTimer = setInterval(() => {
    if (isHistoryVisible) {
      loadHistory();
    }
    // 同时更新任务计数
    updateTaskCounter();
  }, AUTO_REFRESH_INTERVAL);
}

startGlobalAutoRefresh();

// ========== 字数统计 ==========
function initCharCount() {
  text2imgPrompt.addEventListener('input', (e) => {
    text2imgCount.textContent = e.target.value.length;
  });

  img2imgPrompt.addEventListener('input', (e) => {
    img2imgCount.textContent = e.target.value.length;
  });
}

// ========== 本地图片上传（支持多选） ==========
function initFileUpload() {
  img2imgFileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // 校验所有文件都是图片
    const invalidFiles = files.filter(f => !f.type.startsWith('image/'));
    if (invalidFiles.length > 0) {
      alert('请只选择图片文件');
      return;
    }

    // 逐个读取为 base64
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        uploadedImagesBase64.push(event.target.result);
        renderImagePreview();
      };
      reader.readAsDataURL(file);
    });
  });
}

// 渲染预览图列表
function renderImagePreview() {
  if (uploadedImagesBase64.length === 0) {
    img2imgFilePreview.innerHTML = '';
    img2imgFilePreview.style.display = 'none';
    return;
  }

  img2imgFilePreview.innerHTML = `
    <div class="preview-grid">
      ${uploadedImagesBase64.map((src, i) => `
        <div class="preview-item" style="position: relative; display: inline-block; margin: 4px;">
          <img src="${proxyUrl(src)}" alt="预览${i + 1}" style="width: 100px; height: 100px; object-fit: cover; border-radius: 6px; cursor: pointer;" onclick="openImageModal('${proxyUrl(src)}')">
          <button type="button" class="btn-remove" onclick="removeUploadedImage(${i})">×</button>
        </div>
      `).join('')}
    </div>
  `;
  img2imgFilePreview.style.display = 'block';
}

window.removeUploadedImage = function(index) {
  if (index !== undefined && index !== null) {
    // 移除指定索引的单张图片
    uploadedImagesBase64.splice(index, 1);
  } else {
    // 兼容旧调用：清空全部
    uploadedImagesBase64 = [];
  }
  // 如果全部清空了，重置 file input
  if (uploadedImagesBase64.length === 0) {
    img2imgFileInput.value = '';
  }
  renderImagePreview();
};

// ========== 表单提交 ==========
function initForms() {
  text2imgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = text2imgPrompt.value.trim();

    if (!prompt) {
      alert('请输入提示词');
      return;
    }

    submitTaskAsync('text2img', prompt, []);
  });

  img2imgForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    let imageUrls = [];

    if (uploadedImagesBase64.length > 0) {
      // 本地上传的图片（base64）
      imageUrls = [...uploadedImagesBase64];
    } else {
      // URL 输入
      imageUrls = img2imgUrls.value
        .split('\n')
        .map(url => url.trim())
        .filter(url => url);
    }

    const prompt = img2imgPrompt.value.trim();

    if (imageUrls.length === 0) {
      alert('请上传图片或输入图片 URL');
      return;
    }

    if (!prompt) {
      alert('请输入提示词');
      return;
    }

    submitTaskAsync('img2img', prompt, imageUrls);
  });
}

// ========== 异步提交任务（队列模式：立即释放，后台处理） ==========
function submitTaskAsync(type, prompt, imageUrls) {
  const form = type === 'text2img' ? text2imgForm : img2imgForm;
  const btn = form.querySelector('button[type="submit"]');

  // 生成临时任务ID
  const tempTaskId = 'temp_' + Date.now();

  // 立即添加到本地任务队列（历史记录可见）
  const localTask = {
    taskId: tempTaskId,
    type,
    prompt,
    imageUrls,
    status: 'submitting', // 提交中（在队列中显示）
    createdAt: new Date().toISOString(),
    isLocal: true // 标记为本地临时任务
  };

  localTaskQueue.unshift(localTask);
  updateTaskCounter();

  // 立即清空表单，让用户可以继续输入
  if (type === 'text2img') {
    text2imgPrompt.value = '';
    text2imgCount.textContent = '0';
  } else {
    img2imgUrls.value = '';
    img2imgPrompt.value = '';
    img2imgCount.textContent = '0';
    removeUploadedImage();
  }

  // ===== 关键改动：立即恢复按钮，不等待 API 返回 =====
  btn.disabled = false;
  btn.textContent = '生成图片';

  // ✅ 立即弹出成功提示（乐观反馈）
  showSubmitSuccessToast();

  // 后台静默发送请求，完全不影响用户操作
  fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      prompt,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined
    })
  })
    .then(response => {
      if (!response.ok) {
        return response.json().then(error => {
          throw new Error(error.error || '提交失败');
        });
      }
      return response.json();
    })
    .then(data => {
      console.log('✓ 任务已提交:', data.taskId);

      // 从本地临时队列移除，服务器已有正式记录
      localTaskQueue = localTaskQueue.filter(t => t.taskId !== tempTaskId);
      updateTaskCounter();

      // 刷新历史记录以显示服务器返回的正式任务
      loadHistory();
    })
    .catch(error => {
      console.error('✗ 提交失败:', error);

      // 更新本地任务状态为失败（用户可在历史记录中看到并重试）
      const task = localTaskQueue.find(t => t.taskId === tempTaskId);
      if (task) {
        task.status = 'failed';
        task.errorMessage = error.message;
      }

      // 静默通知，不打断用户
      showNotification(`✗ 提交失败: ${error.message}`, 'error');
      loadHistory();
    });
}

// ========== 通知提示 ==========
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

/**
 * 提交成功专用弹窗 — 居中显示，2秒后自动消失，不跳转页面
 */
function showSubmitSuccessToast() {
  // 移除已存在的（防止重复）
  let existing = document.getElementById('submit-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'submit-toast';
  toast.className = 'submit-success-toast';
  toast.innerHTML = `
    <div class="toast-icon">✓</div>
    <div class="toast-text">任务提交成功</div>
  `;
  document.body.appendChild(toast);

  // 触发入场动画（延迟一帧让 transition 生效）
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  // 2秒后自动消失
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 350);
  }, 2000);
}

// ========== 历史记录（增量更新，防止整块闪烁抖动） ==========

/**
 * 生成任务快照（用于比较变化）
 */
function snapshotTasks(tasks) {
  const snap = {};
  for (const t of tasks) {
    snap[t.taskId] = { status: t.status, resultUrl: t.resultUrl || null, errorMessage: t.errorMessage || null };
  }
  return snap;
}

async function loadHistory() {
  try {
    const response = await fetch(`${API_BASE}/history?page=1&limit=50`);

    if (!response.ok) {
      throw new Error('加载失败');
    }

    const data = await response.json();

    if (!isHistoryVisible) return;

    // 合并本地队列和服务器数据
    const allTasks = [...localTaskQueue, ...data.items];

    // 更新任务计数（从服务器数据中统计 pending 状态）
    const pendingCount = data.items.filter(t => t.status === 'pending').length;
    const totalActiveTasks = localTaskQueue.length + pendingCount;
    taskCounter.textContent = `当前任务: ${totalActiveTasks}`;

    if (totalActiveTasks > 0) {
      taskCounter.className = 'task-counter active';
    } else {
      taskCounter.className = 'task-counter';
    }

    // === 增量更新逻辑 ===
    // 比较本次数据与上次渲染的快照
    const currentSnapshot = snapshotTasks(allTasks);
    const hasChanged = !lastRenderedTasks ||
      JSON.stringify(currentSnapshot) !== JSON.stringify(lastRenderedTasks);

    if (allTasks.length === 0) {
      historyContent.innerHTML = '<p style="text-align: center; color: #999;">暂无历史记录</p>';
      lastRenderedTasks = currentSnapshot;
      return;
    }

    // 数据有变化才重新渲染；否则跳过（避免闪烁）
    if (!hasChanged) return;

    lastRenderedTasks = currentSnapshot;
    historyContent.innerHTML = allTasks.map(item => createHistoryItemHTML(item)).join('');
    bindHistoryEvents();
  } catch (error) {
    console.error('错误:', error);
    if (isHistoryVisible) {
      historyContent.innerHTML = `<p style="color: #ff4d4f;">加载失败: ${error.message}</p>`;
    }
  }
}

function bindHistoryEvents() {
  // 删除按钮 — 匹配 .delete-history-btn
  document.querySelectorAll('.delete-history-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteTask(btn.getAttribute('data-task-id'));
    });
  });

  // 重试按钮
  document.querySelectorAll('.history-item-retry').forEach(btn => {
    btn.addEventListener('click', () => {
      retryTask(btn.getAttribute('data-task-id'));
    });
  });

  // 下载按钮 — 匹配 .download-btn
  document.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // <a> 标签本身有 download 属性会自动下载，不需要额外处理
      return true;
    });
  });

  document.querySelectorAll('.history-item-image img').forEach(img => {
    img.addEventListener('click', () => {
      openImageModal(img.src);
    });
  });
}

function createHistoryItemHTML(item) {
  const typeMap = { 'text2img': '文生图', 'img2img': '图生图', 'gridsplit': '宫格拆分' };
  const typeLabel = typeMap[item.type] || item.type;

  let statusLabel, statusClass;
  if (item.isLocal) {
    if (item.status === 'submitting') { statusLabel = '提交中'; statusClass = 'submitting'; }
    else if (item.status === 'failed') { statusLabel = '提交失败'; statusClass = 'failed'; }
  } else {
    statusLabel = { 'pending': '处理中', 'completed': '已完成', 'failed': '失败' }[item.status] || item.status;
    statusClass = item.status;
  }

  const createdDate = new Date(item.createdAt).toLocaleString();

  // 安全的 ID（兼容 undefined taskId 的僵尸记录）
  const safeTaskId = item.taskId || item.id || `zombie_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

  // Build action buttons
  let actions = '';

  // 删除按钮 — 所有记录都有
  actions += `<button class="delete-history-btn" data-task-id="${safeTaskId}">删除</button>`;

  // 重试按钮 — 所有失败任务（含宫格拆分）
  if (item.status === 'failed') {
    actions += `<button class="btn btn-small history-item-retry" data-task-id="${safeTaskId}" data-type="${item.type || ''}">🔄 重试</button>`;
  }

  // 下载按钮 — 有结果 URL 的记录
  if (item.status === 'completed') {
    // 宫格拆分：不显示整体下载（图片各自有链接）
    if (!item.isLocal && item.resultUrl) {
      actions += `<a href="${item.resultUrl}" download class="download-btn" data-url="${item.resultUrl}">⬇ 下载</a>`;
    }
  }

  // Card header
  let html = `
    <div class="history-item" data-task-id="${safeTaskId}">
      <div class="history-item-header">
        <div style="display: flex; gap: 8px; align-items: center;">
          <span class="history-item-type">${typeLabel}</span>
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">${statusLabel}</span>
        </div>
        <span class="history-item-time">${createdDate}</span>
      </div>
      <div class="history-item-prompt">${escapeHtml(item.prompt)}</div>

      <!-- Image + URL bar (for completed tasks) -->
  `;

  // Images section
  if (item.status === 'completed') {
    // 安全解析 gridImages（可能是字符串或数组）
    const _gridImages = (item.gridImages && typeof item.gridImages === 'string')
      ? (() => { try { return JSON.parse(item.gridImages); } catch(_) { return []; }})()
      : (Array.isArray(item.gridImages) ? item.gridImages : []);

    if (item.type === 'gridsplit' && _gridImages.length > 0) {
      // Grid split result: 图片网格预览 + 底部文件夹路径
      const _meta = item.metadata && typeof item.metadata === 'string'
        ? (() => { try { return JSON.parse(item.metadata); } catch(_) { return {}; }})()
        : (typeof item.metadata === 'object' ? item.metadata : {});
      const folderPath = _meta.outputDir || '(未知路径)';

      html += `
        <div class="history-item-image" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
          ${_gridImages.map((img, gi) => `
            <img src="${img.url || ''}" alt="${img.filename || ('图' + (gi+1))}"
              loading="lazy"
              style="max-width:200px;max-height:150px;border-radius:var(--radius-xs);border:1px solid var(--border-subtle);object-fit:cover;cursor:pointer;"
              onclick="openImageModal('${img.url || ''}')"
              onerror="this.onerror=null;this.src='';this.style.background='var(--bg-surface-2)';this.alt='图片加载失败';"
              title="${escapeHtml(img.filename || '')}">
          `).join('')}
        </div>
        <div style="
          display:flex;align-items:center;gap:10px;
          padding:10px 14px;background:rgba(255,255,255,0.03);
          border:1px solid var(--border-subtle);border-radius:var(--radius-xs);
          font-size:13px;color:var(--text-tertiary);
        ">
          <span>📁 存放文件夹：</span>
          <code style="
            flex:1;font-family:'SF Mono',ui-monospace,Consolas,monospace;
            font-size:12px;color:var(--text-secondary);
            word-break:break-all;user-select:text;
          ">${escapeHtml(folderPath)}</code>
          <button class="copy-url-btn" onclick="copyImageUrl(this,'${folderPath.replace(/'/g,"\\'")}');event.stopPropagation();">复制</button>
        </div>
      `;
    } else if (item.resultUrl) {
      // Single image (text2img / img2img)
      html += `
        <div class="history-item-image">
          <img src="${proxyUrl(item.resultUrl)}" alt="生成结果" loading="lazy"
            onclick="openImageModal('${proxyUrl(item.resultUrl)}')">
          <div class="history-url-bar">
            <span class="history-url-text" title="${item.resultUrl}">${escapeHtml(item.resultUrl)}</span>
            <button class="copy-url-btn" onclick="copyImageUrl(this,'${item.resultUrl}');event.stopPropagation();">复制</button>
          </div>
        </div>
      `;
    }
  }

  // Error message
  if (item.status === 'failed' && item.errorMessage) {
    html += `<div style="color:#ef4444;font-size:12px;margin-top:8px;">错误: ${escapeHtml(item.errorMessage)}</div>`;
  }

  // Action footer
  html += `
      <div style="margin-top:12px;display:flex;gap:8px;">${actions}</div>
    </div>
  `;

  return html;
}

// ========== 一键清空历史 ==========
async function clearAllHistory() {
  if (!confirm('确定清空所有历史记录吗？此操作不可恢复！')) return;

  try {
    const response = await fetch(`${API_BASE}/history?page=1&limit=1000`);
    const data = await response.json();

    const deletePromises = data.items.map(item =>
      fetch(`${API_BASE}/task/${item.taskId}`, { method: 'DELETE' })
    );

    await Promise.all(deletePromises);

    // 清空本地队列
    localTaskQueue = [];
    updateTaskCounter();

    loadHistory();
    showNotification('✓ 已清空所有历史记录', 'success');
  } catch (error) {
    console.error('错误:', error);
    showNotification(`✗ 清空失败: ${error.message}`, 'error');
  }
}

async function deleteTask(taskId) {
  try {
    const response = await fetch(`${API_BASE}/task/${taskId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `服务器错误 (${response.status})`);
    }

    // 从 DOM 移除卡片（即时反馈）
    const card = document.querySelector(`.history-item[data-task-id="${taskId}"]`);
    if (card) card.remove();

    loadHistory();
    showNotification('✓ 已删除', 'success');
  } catch (error) {
    console.error('删除失败:', error);
    showNotification(`✗ 删除失败: ${error.message}`, 'error');
  }
}

// ========== 重试失败任务（支持文生图/图生图/宫格拆分） ==========
async function retryTask(taskId) {
  try {
    // 先从数据库获取任务详情，判断类型
    const historyRes = await fetch(`${API_BASE}/history?page=1&limit=100`);
    const historyData = await historyRes.json();
    const taskItem = historyData.items.find(item => item.taskId === taskId);

    if (!taskItem) {
      throw new Error('任务不存在');
    }

    // 根据任务类型走不同的重试逻辑
    if (taskItem.type === 'gridsplit' || (taskItem.metadata && taskItem.metadata.gridType)) {
      // 宫格拆分：重新调用 /api/split-grid
      showNotification('⏳ 正在重新提交宫格拆分...', 'info');
      await resubmitGridSplit(taskItem);
    } else {
      // 文生图/图生图：调用后端 /api/retry
      showNotification('⏳ 正在重新提交生成任务...', 'info');
      await fetchRetryAPI(taskId);
    }

    loadHistory();
  } catch (error) {
    console.error('重试失败:', error);
    showNotification(`✗ 重试失败: ${error.message}`, 'error');
  }
}

async function fetchRetryAPI(taskId) {
  const response = await fetch(`${API_BASE}/retry/${taskId}`, { method: 'POST' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `服务器错误 (${response.status})`);
  }
  showNotification('✓ 任务已重新提交', 'success');
}

// 宫格拆分重提交：读取原始参数，重新发请求
async function resubmitGridSplit(taskItem) {
  let imageBase64 = '';
  let imageUrl = '';

  // 尝试恢复图片数据
  if (taskItem.imageUrls && taskItem.imageUrls.length > 0) {
    imageUrl = taskItem.imageUrls[0];
  } else if (taskItem.prompt && taskItem.prompt.startsWith('data:image')) {
    imageBase64 = taskItem.prompt;
  }

  if (!imageUrl && !imageBase64) {
    throw new Error('原始图片信息丢失，无法重试。请手动重新上传图片');
  }

  const gridType = (taskItem.metadata && taskItem.metadata.gridType) || '4grid';

  const body = {
    gridType,
    imageType: imageUrl ? 'url' : 'upload'
  };

  if (imageUrl) {
    body.imageUrl = imageUrl;
  } else {
    body.image = imageBase64;
  }

  const response = await fetch(`${API_BASE}/split-grid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new ResultError(result.error || '拆分请求失败', result);
  }

  showNotification('✓ 宫格拆分已重新提交', 'success');

  // 如果立即返回了结果，直接展示
  if (result.success && result.images && result.images.length > 0) {
    renderGridResult(result, false);
  }
}

async function copyImageUrl(btn, url) {
  try {
    await navigator.clipboard.writeText(url);
    btn.innerHTML = '✅ 已复制';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = '📋 复制'; btn.classList.remove('copied'); }, 1500);
  } catch (err) {
    // 降级方案：用 textarea 复制
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.innerHTML = '✅ 已复制';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = '📋 复制'; btn.classList.remove('copied'); }, 1500);
  }
}

function downloadImage(url) {
  const link = document.createElement('a');
  link.href = url;
  link.download = `image-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ========== 图片放大预览 ==========
function openImageModal(src) {
  modalImage.src = src;
  imageModal.style.display = 'flex';
}

function closeImageModal() {
  imageModal.style.display = 'none';
  modalImage.src = '';
}

// ========== 工具函数 ==========
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ========== 宫格拆分功能 ==========

// 宫格拆分 DOM
const gridSplitForm = document.getElementById('gridSplitForm');
const gridImageFile = document.getElementById('gridImageFile');
const gridImagePreview = document.getElementById('gridImagePreview');
const gridImageUrl = document.getElementById('gridImageUrl');
const gridTypeSelect = document.getElementById('gridTypeSelect');
const gridSplitBtn = document.getElementById('gridSplitBtn');
const gridSplitBtnText = document.getElementById('gridSplitBtnText');
const gridSplitSpinner = document.getElementById('gridSplitSpinner');
const gridProgress = document.getElementById('gridProgress');
const gridProgressBar = document.getElementById('gridProgressBar');
const gridStatusText = document.getElementById('gridStatusText');
const gridResultSection = document.getElementById('gridResultSection');
const gridResultGrid = document.getElementById('gridResultGrid');
const gridResultMeta = document.getElementById('gridResultMeta');
const downloadAllBtn = document.getElementById('downloadAllBtn');

let gridImageData = null; // 存储上传的图片 base64

/**
 * 初始化宫格拆分的图片预览（单张）
 */
function initGridImageUpload() {
  gridImageFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      gridImageData = event.target.result; // data:image/xxx;base64,...
      gridImagePreview.innerHTML = `
        <div class="preview-item" style="position: relative; display: inline-block;">
          <img src="${proxyUrl(gridImageData)}" alt="待拆分图片"
            style="max-width: 200px; max-height: 200px; object-fit: contain; border-radius: 8px; border: 1px solid #e0e0e0;"
            onclick="openImageModal('${proxyUrl(gridImageData)}')">
          <button type="button" class="btn-remove" style="top: -8px; right: -8px;" onclick="clearGridImage()">×</button>
          <p style="font-size: 12px; color: #666; margin-top: 4px;">${file.name}</p>
        </div>
      `;
      gridImagePreview.style.display = 'block';
      // 清空 URL 输入
      gridImageUrl.value = '';
    };
    reader.readAsDataURL(file);
  });

  // URL 输入时清空文件选择
  gridImageUrl.addEventListener('input', () => {
    if (gridImageUrl.value.trim()) {
      clearGridImage();
    }
  });
}

window.clearGridImage = function() {
  gridImageData = null;
  gridImageFile.value = '';
  gridImagePreview.innerHTML = '';
  gridImagePreview.style.display = 'none';
};

/**
 * 提交宫格拆分请求
 */
function initGridSplitForm() {
  gridSplitForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // 验证输入
    const urlInput = gridImageUrl.value.trim();

    if (!gridImageData && !urlInput) {
      alert('请上传图片或输入图片 URL');
      return;
    }

    const gridType = gridTypeSelect.value;

    // 禁用按钮，显示加载状态
    setGridLoading(true);

    // 显示进度条
    showGridProgress(true);

    try {
      let body;
      if (urlInput) {
        body = { image: urlInput, gridType, imageType: 'url' };
        updateGridStatus(`📋 提交${gridType === '9' ? '九' : '四'}宫格拆分任务...`);
      } else {
        body = { image: gridImageData, gridType, imageType: 'file' };
        updateGridStatus(`📋 上传图片并提交拆分任务...`);
      }

      // ── 异步提交：立即获得 taskId ──
      const response = await fetch(`${API_BASE}/split-grid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!result.taskId) {
        throw new Error(result.error || '创建任务失败');
      }

      const taskId = result.taskId;

      // ✅ 任务已创建！立即在历史记录中插入 pending 卡片
      const promptText = urlInput
        ? `[URL] ${urlInput.substring(0, 80)}${urlInput.length > 80 ? '...' : ''}`
        : '[本地上传]';

      insertPendingCard(taskId, 'gridsplit', `宫格拆分（${gridType === '9' ? '九' : '四'}宫格）`, promptText);
      showNotification('✅ 宫格拆分任务已提交，可在历史记录中查看进度', 'success');

      // 启动轮询——每3秒查询一次状态，完成后自动更新卡片
      pollTaskUntilDone(taskId, gridType);

      // 重置表单
      resetGridForm();

    } catch (error) {
      console.error('[Grid Split] 错误:', error);
      setGridLoading(false);
      showGridProgress(false);

      showNotification(`❌ ${error.message}`, 'error');

      gridResultSection.classList.remove('hidden');
      gridResultGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-tertiary);">
          <p style="font-size: 18px;">⚠️ 拆分失败</p>
          <p style="margin-top: 10px;">${escapeHtml(error.message)}</p>
          <p style="margin-top: 5px; font-size: 13px;">请检查图片是否为有效的宫格图</p>
        </div>
      `;
      gridResultMeta.textContent = '';
    }
  });

  // 下载全部按钮
  downloadAllBtn.addEventListener('click', () => {
    const imgs = gridResultGrid.querySelectorAll('.grid-result-item img');
    imgs.forEach((img, i) => {
      setTimeout(() => {
        downloadImage(img.src);
      }, i * 300); // 错开下载时间避免浏览器拦截
    });
  });
}

/**
 * 在历史记录列表顶部插入一个 pending 状态的任务卡片
 */
function insertPendingCard(taskId, type, typeName, prompt) {
  const historyContent = document.getElementById('historyContent');
  if (!historyContent) return;

  // 切换到历史记录选项卡
  switchTab('history');

  const now = new Date().toLocaleString();
  const typeLabel = { 'text2img': '文生图', 'img2img': '图生图', 'gridsplit': typeName }[type] || type;

  const card = document.createElement('div');
  card.className = 'history-item';
  card.dataset.taskId = taskId;
  card.style.animation = 'fadeIn 0.3s ease';
  card.id = `pending-card-${taskId}`;

  card.innerHTML = `
    <div class="history-item-header">
      <div style="display: flex; gap: 8px; align-items: center;">
        <span class="history-item-type">${typeLabel}</span>
        <span class="task-status-pill status-pending" style="
          font-size:11px;font-weight:500;color:#f59e0b;background:rgba(245,158,11,0.12);
          border:1px solid rgba(245,158,11,0.25);border-radius:9999px;padding:3px 10px;">
          ⏳ 处理中
        </span>
      </div>
      <span class="history-item-time">${now}</span>
    </div>
    <div class="history-item-prompt">${escapeHtml(prompt)}</div>
    <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:14px;">
      <div class="spinner"></div>
      <p style="margin-top:10px;">任务正在后台处理中，请稍候...</p>
      <p style="font-size:12px;margin-top:4px;">（可切换其他页面继续使用，完成后自动更新）</p>
    </div>
  `;

  historyContent.insertBefore(card, historyContent.firstChild);

  if (historyContent.querySelector('.empty-state')) {
    historyContent.querySelector('.empty-state')?.remove();
  }
}

/**
 * 轮询查询任务状态直到完成
 */
async function pollTaskUntilDone(taskId, gridType) {
  let pollCount = 0;
  const MAX_POLL = 180; // 最多轮询 3 分钟（每 3s 一次）

  while (pollCount++ < MAX_POLL) {
    await sleep(3000);

    try {
      const res = await fetch(`/api/task/${taskId}`);
      const task = await res.json();

      if (task.error || !task.status) continue;

      const cardEl = document.getElementById(`pending-card-${taskId}`);
      if (!cardEl) break;

      // 更新状态显示
      const pill = cardEl.querySelector('.task-status-pill');
      const contentArea = cardEl.querySelector('div[style*="text-align:center"]');

      if (task.status === 'completed' && task.gridImages) {
        // ✅ 成功——替换为结果
        if (pill) {
          pill.textContent = '✅ 已完成';
          pill.style.color = '#10b981';
          pill.style.background = 'rgba(16,185,129,0.12)';
          pill.style.borderColor = 'rgba(16,185,129,0.25)';
        }

        try {
          const gridImages = (typeof task.gridImages === 'string')
            ? (() => { try { return JSON.parse(task.gridImages); } catch(_) { return []; }})()
            : (Array.isArray(task.gridImages) ? task.gridImages : []);

          if (gridImages.length > 0) {
            const _meta = (typeof task.metadata === 'string')
              ? (() => { try { return JSON.parse(task.metadata); } catch(_) { return {}; }})()
              : (typeof task.metadata === 'object' ? task.metadata || {} : {});
            const folderPath = _meta.outputDir || '(未知路径)';

          contentArea.outerHTML = `
            <div class="history-item-image" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
              ${gridImages.map((img, gi) => `
                <img src="${img.url || ''}" alt="${img.filename || ('图'+(gi+1))}"
                  loading="lazy"
                  style="max-width:200px;max-height:150px;border-radius:var(--radius-xs);
                    border:1px solid var(--border-subtle);object-fit:cover;cursor:pointer;"
                  onclick="openImageModal('${img.url || ''}')"
                  onerror="this.onerror=null;this.src='';this.style.background='var(--bg-surface-2)';
                    this.alt='图片加载失败';"
                  title="${escapeHtml(img.filename||'')}">
              `).join('')}
            </div>
            <div style="
              display:flex;align-items:center;gap:10px;
              padding:10px 14px;background:rgba(255,255,255,0.03);
              border:1px solid var(--border-subtle);border-radius:var(--radius-xs);
              font-size:13px;color:var(--text-tertiary);">
              <span>📁 存放文件夹：</span>
              <code style="
                flex:1;font-family:'SF Mono',ui-monospace,Consolas,monospace;
                font-size:12px;color:var(--text-secondary);word-break:break-all;user-select:text;">
                ${escapeHtml(folderPath)}</code>
              <button class="copy-url-btn"
                onclick="copyImageUrl(this,'${folderPath.replace(/'/g,"\\'")}');event.stopPropagation();">复制</button>
            </div>
          `;

          showNotification('🎉 宫格拆分完成！', 'success');
        } else {
          contentArea.innerHTML = '<p style="color:var(--success-green);text-align:center;">✅ 拆分完成（无图片数据）</p>';
        }

        } catch (_) {
          contentArea.innerHTML = '<p style="color:var(--success-green);text-align:center;">✅ 拆分完成</p>';
        }
        cardEl.removeAttribute('id');
        setGridLoading(false);
        showGridProgress(false);
        break;

      } else if (task.status === 'failed') {
        // ❌ 失败——显示错误信息
        if (pill) {
          pill.textContent = '❌ 失败';
          pill.style.color = '#ef4444';
          pill.style.background = 'rgba(239,68,68,0.12)';
          pill.style.borderColor = 'rgba(239,68,68,0.25)';
        }
        contentArea.innerHTML = `
          <p style="color:#ef4444;text-align:center;">拆分失败</p>
          ${task.errorMessage ? `<p style="font-size:13px;color:var(--text-muted);margin-top:6px;text-align:center;">${escapeHtml(task.errorMessage.substring(0, 150))}</p>` : ''}
        `;
        cardEl.removeAttribute('id');

        // 添加重试按钮
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'result-actions';
        actionsDiv.style.marginTop = '16px';
        actionsDiv.innerHTML = `<button class="btn btn-small retry-btn" data-task-id="${taskId}">🔄 重试</button>`;
        cardEl.appendChild(actionsDiv);

        showNotification('⚠️ 宫格拆分失败', 'error');
        setGridLoading(false);
        showGridProgress(false);
        break;
      }
    } catch (_) {
      // 轮询失败，继续下一次尝试
    }
  }
}

/** 延迟工具函数 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 重置宫格拆分表单状态
 */
function resetGridForm() {
  gridImageData = null;
  gridImageUrl.value = '';
  gridImageFile.value = '';
  gridImagePreview.innerHTML = '';
  gridImagePreview.style.display = 'none';
}

/**
 * 设置加载状态
 */
function setGridLoading(loading) {
  gridSplitBtn.disabled = loading;
  if (loading) {
    gridSplitBtnText.textContent = '拆分中...';
    gridSplitSpinner.classList.remove('hidden');
  } else {
    gridSplitBtnText.textContent = '开始拆分';
    gridSplitSpinner.classList.add('hidden');
  }
}

/**
 * 显示/隐藏进度区域
 */
function showGridProgress(show) {
  if (show) {
    gridProgress.classList.remove('hidden');
    gridProgressBar.style.width = '0%';
  } else {
    gridProgress.classList.add('hidden');
  }
}

/**
 * 更新进度文字
 */
function updateGridStatus(text) {
  gridStatusText.textContent = text;
}

// 假进度动画（因为 Python 子进程是阻塞的，无法获取真实进度）
let fakeProgressTimer = null;

function startFakeProgress(gridType) {
  const maxIdx = gridType === '9' ? 8 : 3;
  const totalSteps = maxIdx + 2; // +2 for upload and finalization
  let currentStep = 0;

  fakeProgressTimer = setInterval(() => {
    if (currentStep < totalSteps) {
      currentStep++;
      const pct = Math.min((currentStep / totalSteps) * 95, 95); // 最高到 95%，等实际完成时跳到100%
      gridProgressBar.style.width = `${Math.round(pct)}%`;
      const stepNames = ['提交任务', '等待处理', '下载结果'];
      const phaseIdx = Math.min(Math.floor(currentStep / (totalSteps / 3)), 2);
      updateGridStatus(`${stepNames[phaseIdx]}... (${currentStep}/${maxIdx + 1})`);
    } else {
      clearInterval(fakeProgressTimer);
    }
  }, 2000); // 每 2 秒更新一次（模拟每张图的耗时）
}

function stopFakeProgress() {
  if (fakeProgressTimer) {
    clearInterval(fakeProgressTimer);
    fakeProgressTimer = null;
  }
}

/**
 * 渲染拆分结果网格 + 保存到历史记录
 */
function renderGridResult(result) {
  gridResultSection.classList.remove('hidden');

  const gridLabel = result.grid_type === '9' ? '九宫格' : '四宫格';
  const imageCount = result.images ? result.images.length : 0;

  gridResultMeta.innerHTML = `
    <span>${gridLabel} · ${imageCount} 张 · 耗时 ${result.elapsed}s</span>
  `;

  if (result.images && result.images.length > 0) {
    gridResultGrid.innerHTML = result.images.map(img => `
      <div class="grid-result-item" style="position:relative;">
        <img src="${proxyUrl(img.url || img.localPath || '')}"
          alt="${img.filename || `格子 ${img.index}`}"
          loading="lazy"
          onclick="openImageModal('${proxyUrl(img.url || img.localPath)}')"
          onerror="this.onerror=null;this.src='';this.style.background='var(--bg-surface-2)';this.alt='图片加载失败';this.parentElement.innerHTML='<span style=\\'display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:1;color:var(--text-muted);font-size:13px;\\'>⚠ 加载失败</span>'"
          style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius-xs);border:1px solid var(--border-subtle);cursor:pointer;transition:all var(--transition-fast);"
          onmouseover="this.style.borderColor='var(--border-strong)'"
          onmouseout="this.style.borderColor='var(--border-subtle)'">
        <span class="grid-result-label" style="display:block;text-align:center;font-size:11px;color:var(--text-muted);margin-top:4px;">${img.filename || (img.index + 1)}</span>
      </div>
    `).join('');

    // ===== 将拆分结果保存到历史记录 =====
    saveGridSplitHistory(result);
  } else {
    gridResultGrid.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px;">未检测到有效的宫格内容</p>';
  }

  // 滚动到结果区
  gridResultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 宫格拆分完成后，将结果写入历史记录数据库
 */
async function saveGridSplitHistory(result) {
  try {
    const imagesData = (result.images || []).map(img => ({
      url: img.url,
      filename: img.filename || '',
      index: img.index || 0
    }));

    const payload = {
      type: 'gridsplit',
      prompt: `宫格拆分 · ${result.grid_type === '9' ? '九宫格' : '四宫格'} · ${(result.images||[]).length}张`,
      status: 'completed',
      resultUrl: (result.images && result.images[0]) ? result.images[0].url : null,
      gridImages: imagesData,
      metadata: {
        grid_type: result.grid_type,
        total_images: (result.images||[]).length,
        elapsed: result.elapsed || 0,
        output_dir: result.output_dir || ''
      }
    };

    await fetch(`${API_BASE}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('[Grid] 拆分结果已保存到历史记录');
  } catch (err) {
    console.error('[Grid] 保存历史记录失败:', err);
  }
}


// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCharCount();
  initFileUpload();
  initForms();
  initGridImageUpload();
  initGridSplitForm();

  refreshHistoryBtn.addEventListener('click', loadHistory);
  clearHistoryBtn.addEventListener('click', clearAllHistory);

  closeModal.addEventListener('click', closeImageModal);
  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) {
      closeImageModal();
    }
  });
});
