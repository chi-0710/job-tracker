"""本机求职记录服务：提供静态页面并安全转发阿里云截图识别请求。"""

from __future__ import annotations

import base64
import binascii
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import webbrowser


PROJECT_DIR = Path(__file__).resolve().parent
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_REQUEST_BYTES = 14 * 1024 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
REQUESTS_PER_MINUTE = 10
ALLOWED_STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/style.css": "style.css",
    "/app.js": "app.js",
    "/data.js": "data.js",
}
ALLOWED_IMAGE_TYPES = {
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
    "image/webp": b"RIFF",
}
DATA_URL_RE = re.compile(
    r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$"
)

JOB_SCHEMA = {
    "name": "job_posting",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "isJobPosting": {"type": "boolean"},
            "company": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "location": {"type": "string"},
                    "companyType": {"type": "string", "enum": ["", "private", "state"]},
                    "note": {"type": "string"},
                },
                "required": ["name", "location", "companyType", "note"],
                "additionalProperties": False,
            },
            "position": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "salary": {"type": "string"},
                    "channel": {"type": "string"},
                    "applicationDate": {"type": "string"},
                    "status": {"type": "string", "enum": ["pending"]},
                    "note": {"type": "string"},
                },
                "required": ["name", "salary", "channel", "applicationDate", "status", "note"],
                "additionalProperties": False,
            },
            "warnings": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["isJobPosting", "company", "position", "warnings"],
        "additionalProperties": False,
    },
}

SYSTEM_PROMPT = """你是招聘信息截图提取助手。只提取图片中明确出现的信息，禁止推测或补全。
请严格遵守以下规则：
1. 无法确认的字符串返回空字符串，并在 warnings 中说明。
2. 只有截图明确写明企业性质时，companyType 才能返回 private 或 state，否则返回空字符串。
3. company.location 填工作城市或截图中最明确的工作地点。
4. applicationDate 必须为空字符串，招聘发布时间不能视为投递日期。
5. status 必须为 pending。
6. 能明确识别招聘平台时填入 channel，否则为空。
7. position.note 按【岗位职责】【任职要求】【福利待遇】【其他信息】分段整理；没有内容的段落省略。
8. 图片不是招聘信息时，isJobPosting 返回 false，其他字段返回空值。
返回内容必须符合给定 JSON Schema。"""


class ServiceError(Exception):
    def __init__(self, code: str, message: str, status: int = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = int(status)


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def get_config() -> dict[str, object]:
    load_dotenv(PROJECT_DIR / ".env")
    try:
        port = int(os.getenv("JOB_TRACKER_PORT", "8765"))
    except ValueError:
        port = 8765
    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if "请填写" in api_key:
        api_key = ""
    return {
        "api_key": api_key,
        "api_base": os.getenv(
            "DASHSCOPE_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1"
        ).strip().rstrip("/"),
        "model": os.getenv("DASHSCOPE_MODEL", "qwen3.8-flash").strip() or "qwen3.8-flash",
        "port": port,
    }


def validate_image_data_url(value: object) -> str:
    if not isinstance(value, str):
        raise ServiceError("INVALID_IMAGE", "图片数据格式不正确")
    match = DATA_URL_RE.fullmatch(value)
    if not match:
        raise ServiceError("INVALID_IMAGE", "仅支持 PNG、JPEG 或 WebP 图片")
    mime_type, encoded = match.groups()
    try:
        binary = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ServiceError("INVALID_IMAGE", "图片数据无法解析") from error
    if len(binary) > MAX_IMAGE_BYTES:
        raise ServiceError("IMAGE_TOO_LARGE", "图片不能超过 10 MB", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
    signature = ALLOWED_IMAGE_TYPES[mime_type]
    if not binary.startswith(signature):
        raise ServiceError("INVALID_IMAGE", "图片内容与文件格式不一致")
    if mime_type == "image/webp" and (len(binary) < 12 or binary[8:12] != b"WEBP"):
        raise ServiceError("INVALID_IMAGE", "WebP 图片格式不正确")
    return value


def safe_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.replace("\x00", "").strip()[:limit]


def normalize_model_data(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ServiceError("INVALID_MODEL_RESPONSE", "识别结果格式不正确", HTTPStatus.BAD_GATEWAY)
    if value.get("isJobPosting") is not True:
        raise ServiceError("NOT_JOB_POSTING", "这张图片不像招聘信息，请更换截图", HTTPStatus.UNPROCESSABLE_ENTITY)

    company = value.get("company")
    position = value.get("position")
    if not isinstance(company, dict) or not isinstance(position, dict):
        raise ServiceError("INVALID_MODEL_RESPONSE", "识别结果缺少公司或岗位信息", HTTPStatus.BAD_GATEWAY)

    company_type = company.get("companyType")
    if company_type not in ("private", "state"):
        company_type = ""
    warnings = value.get("warnings")
    if not isinstance(warnings, list):
        warnings = []

    return {
        "isJobPosting": True,
        "company": {
            "name": safe_text(company.get("name"), 200),
            "location": safe_text(company.get("location"), 200),
            "companyType": company_type,
            "note": safe_text(company.get("note"), 2000),
        },
        "position": {
            "name": safe_text(position.get("name"), 200),
            "salary": safe_text(position.get("salary"), 200),
            "channel": safe_text(position.get("channel"), 200),
            "applicationDate": "",
            "status": "pending",
            "note": safe_text(position.get("note"), 10000),
        },
        "warnings": [safe_text(item, 300) for item in warnings[:20] if safe_text(item, 300)],
    }


def chat_completions_url(api_base: str) -> str:
    if api_base.endswith("/chat/completions"):
        return api_base
    return f"{api_base}/chat/completions"


def call_dashscope(image_data_url: str, config: dict[str, object]) -> dict[str, object]:
    api_key = str(config["api_key"])
    if not api_key:
        raise ServiceError("MISSING_API_KEY", "请先在 .env 中配置阿里云 API Key", HTTPStatus.SERVICE_UNAVAILABLE)

    payload = {
        "model": config["model"],
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                    {"type": "text", "text": "请提取这张招聘截图，并返回固定 JSON。"},
                ],
            },
        ],
        "response_format": {"type": "json_schema", "json_schema": JOB_SCHEMA},
        "stream": False,
    }
    request = Request(
        chat_completions_url(str(config["api_base"])),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "local-job-tracker/1.0",
        },
        method="POST",
    )
    raw = b""
    for attempt in range(2):
        try:
            with urlopen(request, timeout=45) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            break
        except HTTPError as error:
            if error.code in (401, 403):
                raise ServiceError("AUTH_FAILED", "阿里云 API Key 无效或没有模型权限", HTTPStatus.BAD_GATEWAY) from error
            if error.code == 429:
                raise ServiceError("RATE_LIMITED", "阿里云调用过于频繁，请稍后重试", HTTPStatus.TOO_MANY_REQUESTS) from error
            if error.code >= 500 and attempt == 0:
                continue
            raise ServiceError("UPSTREAM_ERROR", "阿里云识别服务暂时不可用", HTTPStatus.BAD_GATEWAY) from error
        except TimeoutError as error:
            if attempt == 0:
                continue
            raise ServiceError("MODEL_TIMEOUT", "截图识别超时，请稍后重试", HTTPStatus.GATEWAY_TIMEOUT) from error
        except URLError as error:
            if attempt == 0:
                continue
            if isinstance(error.reason, TimeoutError):
                raise ServiceError("MODEL_TIMEOUT", "截图识别超时，请稍后重试", HTTPStatus.GATEWAY_TIMEOUT) from error
            raise ServiceError("NETWORK_ERROR", "无法连接阿里云识别服务", HTTPStatus.BAD_GATEWAY) from error

    if len(raw) > MAX_RESPONSE_BYTES:
        raise ServiceError("INVALID_MODEL_RESPONSE", "识别结果过大", HTTPStatus.BAD_GATEWAY)
    try:
        response_data = json.loads(raw.decode("utf-8"))
        content = response_data["choices"][0]["message"]["content"]
        model_data = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError) as error:
        raise ServiceError("INVALID_MODEL_RESPONSE", "阿里云返回了无法解析的识别结果", HTTPStatus.BAD_GATEWAY) from error
    return normalize_model_data(model_data)


class JobTrackerHandler(BaseHTTPRequestHandler):
    config: dict[str, object] = {}
    recent_requests: deque[float] = deque()
    rate_lock = threading.Lock()

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, relative_name: str) -> None:
        path = PROJECT_DIR / relative_name
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            available = bool(self.config.get("api_key"))
            payload: dict[str, object] = {"available": available}
            if available:
                payload["model"] = self.config["model"]
            else:
                payload["reason"] = "missing_api_key"
            self.send_json(HTTPStatus.OK, payload)
            return
        relative_name = ALLOWED_STATIC_FILES.get(path)
        if relative_name:
            self.send_static(relative_name)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/job-extract":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        origin = self.headers.get("Origin")
        allowed_origins = {
            f"http://127.0.0.1:{self.config['port']}",
            f"http://localhost:{self.config['port']}",
        }
        if origin and origin not in allowed_origins:
            self.send_json(HTTPStatus.FORBIDDEN, {
                "ok": False,
                "error": {"code": "FORBIDDEN_ORIGIN", "message": "不允许的请求来源"},
            })
            return
        if self.headers.get_content_type() != "application/json":
            self.send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {
                "ok": False,
                "error": {"code": "INVALID_CONTENT_TYPE", "message": "请求格式不正确"},
            })
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                "ok": False,
                "error": {"code": "REQUEST_TOO_LARGE", "message": "截图请求不能超过 14 MB"},
            })
            return
        if not self.allow_request():
            self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {
                "ok": False,
                "error": {"code": "LOCAL_RATE_LIMIT", "message": "识别操作过于频繁，请稍后重试"},
            })
            return

        try:
            request_data = json.loads(self.rfile.read(content_length).decode("utf-8"))
            image_data_url = validate_image_data_url(request_data.get("image"))
            data = call_dashscope(image_data_url, self.config)
            self.send_json(HTTPStatus.OK, {"ok": True, "data": data, "warnings": data["warnings"]})
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {
                "ok": False,
                "error": {"code": "INVALID_REQUEST", "message": "请求内容无法解析"},
            })
        except ServiceError as error:
            self.send_json(error.status, {
                "ok": False,
                "error": {"code": error.code, "message": error.message},
            })
        except Exception:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                "ok": False,
                "error": {"code": "INTERNAL_ERROR", "message": "本机识别服务发生错误"},
            })

    def allow_request(self) -> bool:
        now = time.monotonic()
        with self.rate_lock:
            while self.recent_requests and now - self.recent_requests[0] >= 60:
                self.recent_requests.popleft()
            if len(self.recent_requests) >= REQUESTS_PER_MINUTE:
                return False
            self.recent_requests.append(now)
            return True

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {self.command} {urlparse(self.path).path}")


def main() -> None:
    config = get_config()
    JobTrackerHandler.config = config
    server = ThreadingHTTPServer(("127.0.0.1", int(config["port"])), JobTrackerHandler)
    url = f"http://127.0.0.1:{config['port']}/"
    print(f"求职记录 AI 模式已启动：{url}")
    if not config["api_key"]:
        print("提示：请复制 .env.example 为 .env，并填写 DASHSCOPE_API_KEY。")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
