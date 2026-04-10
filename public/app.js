// ========== 配置 ==========
const API_BASE = '/api';
const AUTO_REFRESH_INTERVAL = 2000; // 2秒自动刷新历史记录

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
let uploadedImageBase64 = null;

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

// ========== 本地图片上传 ==========
function initFileUpload() {
  img2imgFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      uploadedImageBase64 = event.target.result;

      img2imgFilePreview.innerHTML = `
        <img src="${uploadedImageBase64}" alt="预览">
        <button type="button" class="btn-remove" onclick="removeUploadedImage()">×</button>
      `;
      img2imgFilePreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });
}

window.removeUploadedImage = function() {
  uploadedImageBase64 = null;
  img2imgFileInput.value = '';
  img2imgFilePreview.innerHTML = '';
  img2imgFilePreview.style.display = 'none';
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

    if (uploadedImageBase64) {
      imageUrls = [uploadedImageBase64];
    } else {
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
  document.querySelectorAll('.history-item-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteTask(btn.getAttribute('data-task-id'));
    });
  });

  document.querySelectorAll('.history-item-retry').forEach(btn => {
    btn.addEventListener('click', () => {
      retryTask(btn.getAttribute('data-task-id'));
    });
  });

  document.querySelectorAll('.history-item-download').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      downloadImage(url);
    });
  });

  document.querySelectorAll('.history-item-image img').forEach(img => {
    img.addEventListener('click', () => {
      openImageModal(img.src);
    });
  });
}

function createHistoryItemHTML(item) {
  const typeLabel = item.type === 'text2img' ? '文生图' : '图生图';

  // 本地任务的状态标签
  let statusLabel, statusClass;
  if (item.isLocal) {
    if (item.status === 'submitting') {
      statusLabel = '提交中';
      statusClass = 'submitting';
    } else if (item.status === 'failed') {
      statusLabel = '提交失败';
      statusClass = 'failed';
    }
  } else {
    statusLabel = {
      'pending': '处理中',
      'completed': '已完成',
      'failed': '失败'
    }[item.status] || item.status;
    statusClass = item.status;
  }

  const createdDate = new Date(item.createdAt).toLocaleString();

  let actions = '';

  // 本地任务不显示操作按钮
  if (!item.isLocal) {
    actions = `
      <button class="btn btn-small history-item-delete" data-task-id="${item.taskId}">
        删除
      </button>
    `;

    if (item.status === 'failed') {
      actions += `
        <button class="btn btn-small history-item-retry" data-task-id="${item.taskId}">
          重试
        </button>
      `;
    }

    if (item.status === 'completed' && item.resultUrl) {
      actions += `
        <button class="btn btn-small history-item-download" data-url="${item.resultUrl}">
          下载
        </button>
      `;
    }
  }

  let html = `
    <div class="history-item ${item.isLocal ? 'local-task' : ''}">
      <div class="history-item-info">
        <div style="display: flex; gap: 10px; align-items: center;">
          <span class="history-item-type ${item.type}">${typeLabel}</span>
          <span class="history-item-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="history-item-prompt">${escapeHtml(item.prompt)}</div>
        <div class="history-item-time">${createdDate}</div>
  `;

  if (item.status === 'completed' && item.resultUrl) {
    html += `
      <div class="history-item-image">
        <img src="${item.resultUrl}" alt="生成结果" loading="lazy" style="cursor: pointer;">
      </div>
    `;
  }

  if (item.status === 'failed' && item.errorMessage) {
    html += `<div style="color: #ff4d4f; font-size: 12px;">错误: ${escapeHtml(item.errorMessage)}</div>`;
  }

  html += `
      </div>
      <div class="history-item-actions">
        ${actions}
      </div>
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
  if (!confirm('确定删除此记录吗？')) return;

  try {
    const response = await fetch(`${API_BASE}/task/${taskId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('删除失败');
    }

    loadHistory();
    showNotification('✓ 已删除', 'success');
  } catch (error) {
    console.error('错误:', error);
    showNotification(`✗ 删除失败: ${error.message}`, 'error');
  }
}

async function retryTask(taskId) {
  try {
    const response = await fetch(`${API_BASE}/retry/${taskId}`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('重试失败');
    }

    loadHistory();
    showNotification('✓ 任务已重新提交', 'success');
  } catch (error) {
    console.error('错误:', error);
    showNotification(`✗ 重试失败: ${error.message}`, 'error');
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

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCharCount();
  initFileUpload();
  initForms();

  refreshHistoryBtn.addEventListener('click', loadHistory);
  clearHistoryBtn.addEventListener('click', clearAllHistory);

  closeModal.addEventListener('click', closeImageModal);
  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) {
      closeImageModal();
    }
  });
});
