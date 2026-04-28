import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TUZI_BASE_URL = process.env.TUZI_API_BASE_URL || 'https://api.tu-zi.com/v1';
const API_TOKEN = process.env.TUZI_API_TOKEN;              // banana-2 默认密钥
const IMAGE2_TOKEN = process.env.TUZI_IMAGE2_TOKEN;        // image-2 专用密钥

// 生成图片的本地保存目录（相对于项目根目录）
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'public', 'generated-output');

if (!API_TOKEN) {
  console.warn('警告: TUZI_API_TOKEN 未设置');
}
if (IMAGE2_TOKEN) {
  console.log('[Tuzi] 已配置 IMAGE-2 专用密钥');
}

// 确保 generated-output 目录存在
function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`[Tuzi] 创建输出目录: ${OUTPUT_DIR}`);
  }
}

/**
 * 根据 model 名称获取对应的 token 和 response_format 配置
 */
function getModelConfig(model) {
  const isImage2 = model === 'gpt-image-2' || model === 'image-2';
  
  return {
    token: isImage2 ? IMAGE2_TOKEN : API_TOKEN,
    model: isImage2 ? 'gpt-image-2' : 'nano-banana-2',
    responseFormat: isImage2 ? 'b64_json' : 'url',
    size: isImage2 ? '1440x2560' : '1440x2560'
  };
}

/**
 * 将 base64 数据保存为本地 PNG 文件，返回相对 URL 路径
 */
function saveBase64ToDisk(b64Data, taskId) {
  try {
    ensureOutputDir();
    
    const filename = `${taskId}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);
    
    // 将 base64 解码为 Buffer 并写入文件
    const buffer = Buffer.from(b64Data, 'base64');
    fs.writeFileSync(filepath, buffer);
    
    // 返回前端可访问的相对路径
    const relativeUrl = `/generated-output/${filename}`;
    console.log(`[Tuzi] 图片已保存: ${filepath} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);
    
    return relativeUrl;
  } catch (error) {
    console.error(`[Tuzi] 保存图片失败: ${error.message}`);
    return null;
  }
}

/**
 * 从远程 URL 下载图片并保存到本地磁盘，返回相对 URL 路径
 */
async function downloadAndSaveUrl(imageUrl, taskId) {
  try {
    ensureOutputDir();
    
    const filename = `${taskId}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);
    
    console.log(`[Tuzi] 正在从远程下载图片: ${imageUrl.substring(0, 80)}...`);
    
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'image/*'
      }
    });
    
    if (response.status !== 200 || !response.data) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    fs.writeFileSync(filepath, Buffer.from(response.data));
    
    const relativeUrl = `/generated-output/${filename}`;
    const sizeKB = Math.round(Buffer.byteLength(response.data) / 1024);
    console.log(`[Tuzi] 远程图片已保存: ${filepath} (${sizeKB}KB)`);
    
    return relativeUrl;
  } catch (error) {
    console.error(`[Tuzi] 下载远程图片失败: ${error.message}`);
    return null;
  }
}

/**
 * 提交生成任务到兔子 API
 * @param {string} type - 任务类型 ("text2img" 或 "img2img")
 * @param {string} prompt - 提示词
 * @param {string[]} imageUrls - 图片 URL 列表（仅 img2img 时有值）
 * @param {string} [model='nano-banana-2'] - 模型名称 ('nano-banana-2' 或 'gpt-image-2')
 * @returns {Promise<{taskId, status, message, resultUrl?, format?}>}
 */
export async function submitTask(type, prompt, imageUrls = [], model = 'nano-banana-2') {
  const config = getModelConfig(model);
  
  if (!config.token) {
    throw new Error(`${model === 'gpt-image-2' ? 'TUZI_IMAGE2_TOKEN' : 'TUZI_API_TOKEN'} 未配置`);
  }

  try {
    const payload = {
      model: config.model,
      prompt,
      response_format: config.responseFormat,
      stream: false,
      size: config.size
    };

    // 如果是图生图，添加图片列表
    if (type === 'img2img' && imageUrls.length > 0) {
      payload.image = imageUrls;
    }

    const headers = {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    };

    console.log(`[Tuzi API] 提交 ${type} 任务 | model=${config.model} | format=${config.responseFormat}`);
    console.log(`[Tuzi API] Token 长度: ${config.token ? config.token.length : 0}`);
    if (imageUrls.length > 0) {
      console.log(`[Tuzi API] 参考图数量: ${imageUrls.length}`);
    }

    const response = await axios.post(
      `${TUZI_BASE_URL}/images/generations`,
      payload,
      {
        headers,
        timeout: 600000 // 600秒超时（10分钟）
      }
    );

    const { data } = response;

    if (data.data && data.data.length > 0) {
      const result = data.data[0];
      const taskId = result.id || Date.now().toString();

      // ===== 处理 URL 格式返回（banana-2） =====
      if (result.url) {
        // 下载远程图片保存到本地（异步，失败不阻断）
        const localPath = await downloadAndSaveUrl(result.url, taskId);
        
        return {
          taskId,
          status: 'completed',
          resultUrl: localPath || result.url,        // 本地路径优先（前端展示用）
          originalUrl: result.url,                    // 原始 URL 保留（供用户复制/备用）
          format: 'url',
          message: localPath ? '任务已完成 (已保存到本地)' : '任务已完成'
        };
      }

      // ===== 处理 Base64 格式返回（image-2） =====
      if (result.b64_json) {
        const localPath = saveBase64ToDisk(result.b64_json, taskId);
        
        if (localPath) {
          return {
            taskId,
            status: 'completed',
            resultUrl: localPath,
            originalUrl: null,  // base64 模式无原始远程 URL
            format: 'base64',
            message: '任务已完成 (Base64已保存到本地)'
          };
        } else {
          throw new Error('Base64 数据保存失败');
        }
      }
    }

    // 如果没有直接返回结果，可能需要轮询
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
    const headers = {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    };

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
    console.warn(`[Tuzi API] 查询状态失败: ${error.message}`);
    return {
      status: 'pending'
    };
  }
}

/**
 * 重新提交任务（用于失败重试）
 */
export async function retryTask(type, prompt, imageUrls = [], model = 'nano-banana-2') {
  return submitTask(type, prompt, imageUrls, model);
}
