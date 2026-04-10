import axios from 'axios';

const TUZI_BASE_URL = process.env.TUZI_API_BASE_URL || 'https://api.tu-zi.com/v1';
const API_TOKEN = process.env.TUZI_API_TOKEN;

if (!API_TOKEN) {
  console.warn('警告: TUZI_API_TOKEN 未设置');
}

/**
 * 提交生成任务到兔子 API
 * @param {string} type - 任务类型 ("text2img" 或 "img2img")
 * @param {string} prompt - 提示词
 * @param {string[]} imageUrls - 图片 URL 列表（仅 img2img 时有值）
 * @returns {Promise<{taskId, status, message}>}
 */
export async function submitTask(type, prompt, imageUrls = []) {
  try {
    const payload = {
      model: 'nano-banana-2',
      prompt,
      response_format: 'url',
      stream: false,
      token: API_TOKEN  // 直接在 payload 中传递 token
    };

    // 如果是图生图，添加图片列表
    if (type === 'img2img' && imageUrls.length > 0) {
      payload.image = imageUrls;
    }

    const headers = {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    };

    console.log(`[Tuzi API] 提交 ${type} 任务...`);
    console.log(`[Tuzi API] Token 长度: ${API_TOKEN ? API_TOKEN.length : 0}`);

    const response = await axios.post(
      `${TUZI_BASE_URL}/images/generations`,
      payload,
      {
        headers,
        timeout: 600000 // 600秒超时（10分钟），图片生成需要较长时间
      }
    );

    const { data } = response;

    // 根据响应结构，可能需要调整
    // 假设响应包含 data 数组，其中包含 url 或其他字段
    if (data.data && data.data.length > 0) {
      const result = data.data[0];

      // 如果直接返回了 URL，说明任务已完成
      if (result.url) {
        return {
          taskId: result.id || Date.now().toString(),
          status: 'completed',
          resultUrl: result.url,
          message: '任务已完成'
        };
      }
    }

    // 如果没有直接返回 URL，可能需要轮询
    // 返回任务信息供前端轮询
    return {
      taskId: data.id || Date.now().toString(),
      status: 'pending',
      message: '任务已提交，等待处理'
    };
  } catch (error) {
    console.error('[Tuzi API] 提交失败:', error.message);
    if (error.response) {
      console.error('[Tuzi API] 响应状态:', error.response.status);
      console.error('[Tuzi API] 响应数据:', error.response.data);
    }
    throw new Error(`API 调用失败: ${error.message}`);
  }
}

/**
 * 查询任务状态
 * @param {string} taskId - 任务 ID
 * @returns {Promise<{status, resultUrl?, errorMessage?}>}
 */
export async function checkTaskStatus(taskId) {
  try {
    // 注意：这里假设兔子 API 有一个查询端点
    // 如果 API 不提供查询端点，可能需要调整策略
    // 例如，可能需要保存任务提交时的完整响应，然后轮询获取更新

    // 尝试查询端点（需要根据实际 API 文档调整）
    const headers = {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    };

    // 这是一个假设的端点，需要根据实际 API 调整
    const response = await axios.get(
      `${TUZI_BASE_URL}/images/${taskId}`,
      { headers, timeout: 30000 }
    );

    const { data } = response;

    if (data.data && data.data.length > 0) {
      const result = data.data[0];
      if (result.url) {
        return {
          status: 'completed',
          resultUrl: result.url
        };
      }
    }

    return {
      status: 'pending'
    };
  } catch (error) {
    // 如果查询失败，返回 pending 状态
    // 可以添加重试逻辑
    console.warn(`[Tuzi API] 查询状态失败: ${error.message}`);
    return {
      status: 'pending'
    };
  }
}

/**
 * 重新提交任务（用于失败重试）
 */
export async function retryTask(type, prompt, imageUrls = []) {
  return submitTask(type, prompt, imageUrls);
}
