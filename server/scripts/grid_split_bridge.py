# -*- coding: utf-8 -*-
"""
宫格拆分桥接脚本 —— 供 Node.js 后端通过子进程调用
===============================================
输入：JSON（stdin 或命令行参数）
输出：JSON（stdout），结构化结果便于 Node 解析

用法：
  python grid_split_bridge.py --image <图片路径或URL> --grid-type <4|9> --output-dir <输出目录>
  python grid_split_bridge.py --json  # 从 stdin 读取 JSON
"""

import os
import sys
import json
import time
import argparse
import requests

# ──────────────── 腾讯云 SDK 导入 ────────────────
try:
    from tencentcloud.common import credential
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
    from tencentcloud.mps.v20190612 import mps_client, models
except ImportError as _e_mps:
    print(json.dumps({"success": False, "error": f"缺少 MPS 依赖: pip install -r requirements.txt ({_e_mps})"}, ensure_ascii=False))
    sys.exit(1)

try:
    from qcloud_cos import CosConfig, CosS3Client
except ImportError:
    CosConfig = CosS3Client = None

# ──────────────── 配置常量 ────────────────
SCHEDULE_ID = 30050          # 分镜拆图 ScheduleId
REGION = "ap-guangzhou"       # MPS 服务区域
COS_BUCKET = "shorts-store-1418515749"
COS_BUCKET_REGION = "ap-chengdu"

# 从项目根目录的 .env 加载密钥（脚本位于 server/scripts/，需上溯3层到项目根）
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
SECRET_ID = ""
SECRET_KEY = ""


def load_env():
    """从项目根目录 .env 文件加载腾讯云密钥"""
    global SECRET_ID, SECRET_KEY

    if not os.path.exists(ENV_PATH):
        return False

    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key == "TENCENTCLOUD_SECRET_ID":
                SECRET_ID = val
            elif key == "TENCENTCLOUD_SECRET_KEY":
                SECRET_KEY = val
    return bool(SECRET_ID and SECRET_KEY)


def create_mps_client():
    """创建 MPS 客户端"""
    cred = credential.Credential(SECRET_ID, SECRET_KEY)
    httpProfile = HttpProfile()
    httpProfile.endpoint = "mps.tencentcloudapi.com"
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    return mps_client.MpsClient(cred, REGION, clientProfile)


def create_cos_client():
    """创建 COS 客户端，用于签名下载"""
    if CosConfig is None:
        raise ImportError("COS SDK 未安装: pip install cos-python-sdk-v5")
    config = CosConfig(Region=COS_BUCKET_REGION, SecretId=SECRET_ID, SecretKey=SECRET_KEY)
    return CosS3Client(config)


def build_input_info(image_source):
    """
    构建输入信息，仅支持 URL
    返回 input_info 对象
    """
    inp = models.MediaInputInfo()

    if not (image_source.startswith("http://") or image_source.startswith("https://")):
        raise ValueError(f"仅支持 URL 图片源，不支持本地文件: {image_source}")

    inp.Type = "URL"
    url_info = models.UrlInputInfo()
    url_info.Url = image_source
    inp.UrlInputInfo = url_info
    return inp


def submit_task(client, image_source, process_index, model_sampling=0.1):
    """提交单次拆分任务，返回 TaskId"""
    input_info = build_input_info(image_source)

    storyboard_config = {"ModelSamplingAuraFlow": model_sampling}
    if process_index >= 0:
        storyboard_config["ProcessIndex"] = process_index

    std_ext_info = json.dumps({"StoryboardConfig": storyboard_config}, ensure_ascii=False)

    req = models.ProcessImageRequest()
    req.InputInfo = input_info
    req.ScheduleId = SCHEDULE_ID
    req.StdExtInfo = std_ext_info

    output_storage = models.TaskOutputStorage()
    output_storage.Type = "COS"
    cos_output = models.CosOutputStorage()
    cos_output.Bucket = COS_BUCKET
    cos_output.Region = COS_BUCKET_REGION
    output_storage.CosOutputStorage = cos_output
    req.OutputStorage = output_storage

    resp = client.ProcessImage(req)
    return resp.TaskId


def query_task(client, task_id):
    """查询任务状态和结果"""
    req = models.DescribeImageTaskDetailRequest()
    req.TaskId = task_id
    resp = client.DescribeImageTaskDetail(req)

    top_status = getattr(resp, "Status", "")

    if top_status == "FINISH":
        outputs = []
        task_set = getattr(resp, "ImageProcessTaskResultSet", None) or []
        for task in task_set:
            output_obj = getattr(task, "Output", None)
            if output_obj:
                signed_url = getattr(output_obj, "SignedUrl", "") or ""
                path = getattr(output_obj, "Path", "") or ""
                # 确保 path 以 / 开头，避免域名和路径粘连
                if path and not path.startswith("/"):
                    path = "/" + path
                cos_url = f"https://{COS_BUCKET}.cos.{COS_BUCKET_REGION}.myqcloud.com{path}"
                outputs.append({"url": signed_url or cos_url, "path": path})
        return "SUCCESS", outputs
    elif top_status in ("WAITING", "PROCESSING"):
        return "PROCESSING", []
    else:
        return "FAIL", {
            "ErrCode": getattr(resp, "ErrCode", ""),
            "ErrMsg": getattr(resp, "ErrMsg", ""),
            "Message": getattr(resp, "Message", ""),
        }


def poll_task(client, task_id, interval=5, timeout=180):
    """轮询等待完成，返回 (status, result)"""
    start_time = time.time()
    while True:
        elapsed = time.time() - start_time
        if elapsed > timeout:
            return "TIMEOUT", None
        status, result = query_task(client, task_id)
        if status != "PROCESSING":
            return status, result
        time.sleep(interval)


def download_image(url, save_path, client_cos=None, max_retries=5):
    """下载图片到本地（优先用 COS Presigned URL 签名下载）"""
    import time

    # 方式一：COS 文件 -> 用 Presigned URL 下载（解决私有桶 403 问题）
    if client_cos and ("cos." in url or "myqcloud.com" in url):
        cos_key = None
        if ".myqcloud.com" in url:
            url_path = url.split(".myqcloud.com", 1)[1]
            cos_key = url_path.lstrip("/")
        if not cos_key and "/" in url:
            cos_key = url.lstrip("/")

        if cos_key:
            for attempt in range(1, max_retries + 1):
                try:
                    signed_url = client_cos.get_presigned_url(
                        Method="GET",
                        Bucket=COS_BUCKET,
                        Key=cos_key,
                        Expired=300,
                    )
                    resp = requests.get(signed_url, timeout=(15, 120))
                    resp.raise_for_status()
                    if len(resp.content) > 1000:
                        with open(save_path, "wb") as f:
                            f.write(resp.content)
                        return True
                    else:
                        print(f"[WARN] COS Presigned 返回数据过小 ({len(resp.content)}B)", file=sys.stderr)
                except Exception as e:
                    if attempt < max_retries:
                        wait = attempt * 2
                        print(f"[WARN] COS 签名下载第{attempt}次失败: {e}，{wait}秒后重试...", file=sys.stderr)
                        time.sleep(wait)
                    else:
                        print(f"[ERROR] COS 签名下载失败(已重试{max_retries}次): {e}", file=sys.stderr)

    # 方式二：普通 HTTP 下载（回退）
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(
                url,
                timeout=(15, 120),
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            )
            resp.raise_for_status()
            with open(save_path, "wb") as f:
                f.write(resp.content)
            content_len = len(resp.content)
            if content_len < 1000:
                print(f"[WARN] 图片过小 ({content_len}B)，可能不完整", file=sys.stderr)
                return False
            return True
        except Exception as e:
            err_type = type(e).__name__
            wait = attempt * 2
            if attempt < max_retries:
                print(f"[WARN] 第{attempt}次下载失败 ({err_type}): {e}，{wait}秒后重试...", file=sys.stderr)
                time.sleep(wait)
            else:
                print(f"[ERROR] 下载失败(已重试{max_retries}次): {err_type}: {e}", file=sys.stderr)
                return False


# ──────────────── 网格类型配置映射 ────────────────
GRID_CONFIG = {
    "4": {"max_index": 3, "label": "四宫格"},
    "9": {"max_index": 8, "label": "九宫格"},
}


def run_split(image_source, grid_type="4", output_dir=None, model_sampling=0.1):
    """
    执行宫格拆分，返回结构化 JSON 结果

    Returns:
        dict: {
            "success": bool,
            "grid_type": str,
            "total_images": int,
            "images": [{"index": int, "filename": str, "path": str, "url": str}],
            "output_dir": str,
            "elapsed": float,
            "error": str (optional)
        }
    """
    config = GRID_CONFIG.get(str(grid_type))
    if not config:
        return {"success": False, "error": f"不支持的网格类型: {grid_type}，仅支持 4(四宫格) 和 9(九宫格)"}

    max_index = config["max_index"]

    if output_dir is None:
        output_dir = os.path.join(os.getcwd(), "grid-output", f"batch-{uuid.uuid4().hex[:8]}")

    os.makedirs(output_dir, exist_ok=True)

    # 创建客户端
    client = create_mps_client()
    try:
        client_cos = create_cos_client()
    except ImportError as _e:
        print(f"[WARN] COS 客户端创建失败: {_e}，将使用普通 HTTP 下载", file=sys.stderr)
        client_cos = None

    start_time = time.time()
    success_results = []

    for idx in range(max_index + 1):
        try:
            task_id = submit_task(client, image_source, process_index=idx, model_sampling=model_sampling)
            status, result = poll_task(client, task_id, timeout=180)

            if status == "SUCCESS" and isinstance(result, list) and result:
                url = result[0].get("url", "")
                if url:
                    # 保存图片到本地（优先使用 COS 签名下载）
                    local_filename = f"grid_{idx+1}.jpg"
                    local_path = os.path.join(output_dir, local_filename)
                    downloaded = download_image(url, local_path, client_cos=client_cos)
                    success_results.append({
                        "index": idx,
                        "filename": local_filename,
                        "path": local_path,
                        "url": url,  # 保留原始 URL 供参考（可能已过期）
                        "localPath": local_path if downloaded else None,
                    })
                else:
                    pass  # URL 为空，跳过

            elif status == "SUCCESS" and (not result or (isinstance(result, list) and not result)):
                # 无输出 → 超出实际格子数，停止
                break
            else:
                # 任务失败
                if isinstance(result, dict):
                    error_msg = result.get("Message") or result.get("ErrMsg", "未知错误")
                else:
                    error_msg = str(result)
                # 记录失败但继续尝试下一个索引（某些索引可能不存在但不影响其他）
                pass

        except Exception as e:
            print(f"[ERROR] 索引 {idx} 异常: {e}", file=sys.stderr)
            break

        time.sleep(1)  # 限流

    elapsed = round(time.time() - start_time, 1)

    return {
        "success": len(success_results) > 0,
        "grid_type": grid_type,
        "grid_label": config["label"],
        "max_index": max_index,
        "total_images": len(success_results),
        "images": success_results,
        "output_dir": output_dir,
        "elapsed": elapsed,
    }


# ──────────────── 命令行入口 ────────────────
def main():
    parser = argparse.ArgumentParser(description="宫格拆分桥接脚本")
    parser.add_argument("--image", required=True, help="图片源（本地文件路径 或 URL）")
    parser.add_argument("--grid-type", default="4", choices=["4", "9"], help="网格类型：4=四宫格, 9=九宫格（默认4）")
    parser.add_argument("--output-dir", default=None, help="输出目录（默认自动创建）")
    parser.add_argument("--sampling", type=float, default=0.1, help="效果参数（默认0.1）")
    args = parser.parse_args()

    # 加载密钥
    if not load_env():
        print(json.dumps({"success": False, "error": "无法加载腾讯云密钥，请检查 .env 文件"}, ensure_ascii=False))
        sys.exit(1)

    # 执行拆分
    result = run_split(
        image_source=args.image,
        grid_type=args.grid_type,
        output_dir=args.output_dir,
        model_sampling=args.sampling,
    )

    # 输出 JSON 结果（Node.js 通过 stdout 读取）
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 以退出码表示成败
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
