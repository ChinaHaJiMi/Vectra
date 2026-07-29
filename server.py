#!/usr/bin/env python3
"""
VECTRA — 后端服务器（安全强化版）
提供：静态文件服务 + 文件系统读写 API + SSL/TLS 支持
"""

import http.server
import json
import os
import sys
import re
import time
import hmac
import hashlib
import logging
import secrets
import ssl
import subprocess
import urllib.parse
import shutil
from datetime import datetime
from pathlib import Path

# === 配置 ===
PORT = 8080
DATA_DIR = os.path.join(os.path.expanduser("~"), "VectraData")
CERT_DIR = os.path.join(DATA_DIR, "certs")
RATE_LIMIT_PER_MINUTE = 60
CLIENT_BODY_MAX_SIZE = 1024 * 512  # 512KB

# 日志配置
os.makedirs(DATA_DIR, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(DATA_DIR, "server.log"), encoding="utf-8"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("VectraServer")

# 允许的源列表（CORS 白名单）
ALLOWED_ORIGINS = [
    "http://localhost:8080",
    "https://localhost:8080",
    "http://127.0.0.1:8080",
    "https://127.0.0.1:8080",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# 路径名白名单
VALID_ID_PATTERN = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$')

# ===== CSRF Token 管理（会话级：不消耗，持续有效期内可重复使用）=====
class CsrfManager:
    def __init__(self):
        self._tokens = {}  # token -> expiry timestamp

    def generate(self):
        token = secrets.token_hex(32)
        self._tokens[token] = time.time() + 3600  # 1小时过期
        # 清理过期 token
        now = time.time()
        self._tokens = {k: v for k, v in self._tokens.items() if v > now}
        return token

    def validate(self, token):
        if not token:
            return False
        now = time.time()
        expiry = self._tokens.get(token, 0)
        if expiry > now:
            # 会话级 token：不消耗，在有效期内可重复使用
            return True
        return False

csrf_manager = CsrfManager()

# ===== 限流器 =====
class RateLimiter:
    def __init__(self, max_per_minute=60):
        self.max_per_minute = max_per_minute
        self.requests = {}

    def is_allowed(self, ip):
        now = time.time()
        if ip not in self.requests:
            self.requests[ip] = []
        self.requests[ip] = [t for t in self.requests[ip] if now - t < 60]
        if len(self.requests[ip]) >= self.max_per_minute:
            return False
        self.requests[ip].append(now)
        return True

rate_limiter = RateLimiter(RATE_LIMIT_PER_MINUTE)

# ===== 输入净化工具 =====
def sanitize_text(text, max_length=10000):
    if not isinstance(text, str):
        text = str(text)
    text = text[:max_length]
    sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
    return sanitized

def sanitize_json_data(data, max_depth=10):
    if max_depth <= 0:
        return None
    if isinstance(data, str):
        return sanitize_text(data)
    elif isinstance(data, dict):
        return {k: sanitize_json_data(v, max_depth - 1) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_json_data(v, max_depth - 1) for v in data]
    elif isinstance(data, (int, float, bool)) or data is None:
        return data
    else:
        return str(data)

def validate_world_id(world_id):
    if not world_id or not VALID_ID_PATTERN.match(world_id):
        return False
    if '/' in world_id or '\\' in world_id or '..' in world_id:
        return False
    return True

def validate_npc_id(npc_id):
    if not npc_id or not VALID_ID_PATTERN.match(npc_id):
        return False
    if '/' in npc_id or '\\' in npc_id or '..' in npc_id:
        return False
    return True

def safe_path_join(base, *parts):
    base = os.path.realpath(base)
    path = os.path.realpath(os.path.join(base, *parts))
    if not path.startswith(base + os.sep) and path != base:
        raise ValueError("Path traversal detected")
    return path

# ===== 自签名证书生成 =====
def ensure_self_signed_cert():
    """生成自签名证书用于测试环境"""
    os.makedirs(CERT_DIR, exist_ok=True)
    cert_file = os.path.join(CERT_DIR, "vectra_cert.pem")
    key_file = os.path.join(CERT_DIR, "vectra_key.pem")

    # 如果证书已存在且未过期，跳过生成
    if os.path.exists(cert_file) and os.path.exists(key_file):
        cert_age = time.time() - os.path.getmtime(cert_file)
        if cert_age < 86400 * 365:  # 一年内有效
            return cert_file, key_file

    logger.info("正在生成自签名 SSL 证书...")
    # 使用 subprocess 调用 openssl（仅用于测试目的）
    openssl_cmd = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", key_file,
        "-out", cert_file,
        "-days", "365",
        "-nodes",
        "-subj", "/C=CN/ST=Shanghai/L=Shanghai/O=Vectra/CN=localhost",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"
    ]
    try:
        subprocess.run(openssl_cmd, check=True, capture_output=True, timeout=30)
        os.chmod(cert_file, 0o644)
        os.chmod(key_file, 0o600)
        logger.info(f"自签名证书已生成: {cert_file}")
        return cert_file, key_file
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.warning(f"openssl 不可用，将使用 HTTP 模式: {e}")
        return None, None

# === 文件系统 API 处理 ===

class VectraHTTPHandler(http.server.SimpleHTTPRequestHandler):
    """扩展 SimpleHTTPRequestHandler，添加 /api/ 路由"""

    def log_message(self, format, *args):
        logger.info(f"{self.client_address[0]} - {format % args}")

    def get_client_ip(self):
        forwarded = self.headers.get('X-Forwarded-For')
        if forwarded:
            return forwarded.split(',')[0].strip()
        return self.client_address[0]

    def do_OPTIONS(self):
        self._send_cors_headers()
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if not self._check_rate_limit():
            return

        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/status':
            self._send_json({"mode": "server", "ok": True})
        elif parsed.path == '/api/csrf-token':
            token = csrf_manager.generate()
            self._send_json({"token": token})
        elif parsed.path == '/api/loadWorldList':
            self._handle_load_world_list()
        elif parsed.path.startswith('/api/loadWorldData/'):
            world_id = parsed.path.split('/api/loadWorldData/')[1]
            if not validate_world_id(world_id):
                self._send_json({"error": "invalid world id"}, 400)
                return
            self._handle_load_world_data(world_id)
        elif parsed.path.startswith('/api/loadNPCMemory/'):
            parts = parsed.path.split('/api/loadNPCMemory/')[1].split('/')
            if len(parts) == 2 and validate_world_id(parts[0]) and validate_npc_id(parts[1]):
                self._handle_load_npc_memory(parts[0], parts[1])
            else:
                self._send_json({"error": "invalid path"}, 400)
        else:
            super().do_GET()

    def do_POST(self):
        if not self._check_rate_limit():
            return

        parsed = urllib.parse.urlparse(self.path)

        # CSRF 校验：所有写操作必须附带有效 token（/api/csrf-token 本身排除）
        if parsed.path != '/api/csrf-token':
            csrf_token = self.headers.get('X-CSRF-Token', '')
            if not csrf_manager.validate(csrf_token):
                logger.warning(f"[CSRF] 无效或缺失 token: {self.client_address[0]} -> {self.path}")
                self._send_json({"error": "invalid or missing CSRF token"}, 403)
                return

        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > CLIENT_BODY_MAX_SIZE:
            self._send_json({"error": "request body too large"}, 413)
            return

        body = self.rfile.read(content_length) if content_length > 0 else b'{}'

        try:
            parsed_body = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            self._send_json({"error": "invalid JSON"}, 400)
            return

        if parsed.path == '/api/saveWorldList':
            self._handle_save_world_list(parsed_body)
        elif parsed.path.startswith('/api/saveWorldData/'):
            world_id = parsed.path.split('/api/saveWorldData/')[1]
            if not validate_world_id(world_id):
                self._send_json({"error": "invalid world id"}, 400)
                return
            self._handle_save_world_data(world_id, parsed_body)
        elif parsed.path.startswith('/api/saveNPCMemory/'):
            parts = parsed.path.split('/api/saveNPCMemory/')[1].split('/')
            if len(parts) == 2 and validate_world_id(parts[0]) and validate_npc_id(parts[1]):
                self._handle_save_npc_memory(parts[0], parts[1], parsed_body)
            else:
                self._send_json({"error": "invalid path"}, 400)
        elif parsed.path.startswith('/api/deleteWorld/'):
            world_id = parsed.path.split('/api/deleteWorld/')[1]
            if not validate_world_id(world_id):
                self._send_json({"error": "invalid world id"}, 400)
                return
            self._handle_delete_world(world_id)
        else:
            self._send_json({"error": "not found"}, 404)

    # ---- 工具 ----
    def _send_cors_headers(self):
        origin = self.headers.get('Origin', '')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            self.send_header('Access-Control-Allow-Origin', 'http://localhost:8080')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token')
        self.send_header('Access-Control-Max-Age', '86400')

    def _send_json(self, data, status=200):
        self.send_response(status)
        self._send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'))

    def _check_rate_limit(self):
        ip = self.get_client_ip()
        if not rate_limiter.is_allowed(ip):
            logger.warning(f"[RATE_LIMIT] {ip} 超过速率限制")
            self._send_json({"error": "too many requests"}, 429)
            return False
        return True

    def _ensure_dir(self, path):
        os.makedirs(path, exist_ok=True)

    def _read_json_file(self, filepath):
        try:
            safe_path = safe_path_join(DATA_DIR, os.path.relpath(filepath, DATA_DIR))
            with open(safe_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError, ValueError):
            return None

    def _write_json_file(self, filepath, data):
        try:
            safe_path = safe_path_join(DATA_DIR, os.path.relpath(filepath, DATA_DIR))
            self._ensure_dir(os.path.dirname(safe_path))
            with open(safe_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except ValueError:
            logger.error(f"[SECURITY] 路径遍历尝试: {filepath}")

    def _read_text_file(self, filepath):
        try:
            safe_path = safe_path_join(DATA_DIR, os.path.relpath(filepath, DATA_DIR))
            with open(safe_path, 'r', encoding='utf-8') as f:
                return f.read()
        except (FileNotFoundError, ValueError):
            return None

    def _write_text_file(self, filepath, text):
        try:
            safe_path = safe_path_join(DATA_DIR, os.path.relpath(filepath, DATA_DIR))
            self._ensure_dir(os.path.dirname(safe_path))
            with open(safe_path, 'w', encoding='utf-8') as f:
                f.write(text)
        except ValueError:
            logger.error(f"[SECURITY] 路径遍历尝试: {filepath}")

    # ---- API Handlers ----
    def _handle_load_world_list(self):
        filepath = os.path.join(DATA_DIR, 'worlds.json')
        data = self._read_json_file(filepath)
        self._send_json(data or {"worlds": [], "currentWorld": None})

    def _handle_save_world_list(self, data):
        data = sanitize_json_data(data)
        filepath = os.path.join(DATA_DIR, 'worlds.json')
        self._write_json_file(filepath, data)
        self._send_json({"ok": True})

    def _handle_load_world_data(self, world_id):
        world_dir = os.path.join(DATA_DIR, 'worlds', world_id)
        meta = self._read_json_file(os.path.join(world_dir, 'meta.json'))
        npcs = self._read_json_file(os.path.join(world_dir, 'npcs.json'))
        quests = self._read_json_file(os.path.join(world_dir, 'quests.json'))
        msgs = self._read_json_file(os.path.join(world_dir, 'conversations.json'))
        play_events = self._read_json_file(os.path.join(world_dir, 'play_events.json'))
        play_scene = self._read_json_file(os.path.join(world_dir, 'play_scene.json'))
        if meta:
            self._send_json({
                "phase": meta.get("phase", 1),
                "bible": meta.get("bible", {"lore": "", "laws": [], "era": ""}),
                "npcs": npcs or [],
                "quests": quests or [],
                "messages": msgs or [],
                "launched": meta.get("launched", False),
                "playEvents": play_events or [],
                "playScene": play_scene or [],
                "playClock": meta.get("playClock", {"day": 1, "hour": 0, "minute": 0}),
                "npcsConfirmed": meta.get("npcsConfirmed", False),
                "questsConfirmed": meta.get("questsConfirmed", False),
            })
        else:
            self._send_json(None)

    def _handle_save_world_data(self, world_id, data):
        data = sanitize_json_data(data)
        world_dir = os.path.join(DATA_DIR, 'worlds', world_id)
        self._ensure_dir(world_dir)
        self._write_json_file(os.path.join(world_dir, 'meta.json'), {
            "phase": data.get("phase", 1),
            "bible": data.get("bible", {"lore": "", "laws": [], "era": ""}),
            "launched": data.get("launched", False),
            "playClock": data.get("playClock", {"day": 1, "hour": 0, "minute": 0}),
            "npcsConfirmed": data.get("npcsConfirmed", False),
            "questsConfirmed": data.get("questsConfirmed", False),
        })
        if "npcs" in data:
            self._write_json_file(os.path.join(world_dir, 'npcs.json'), data["npcs"])
        if "quests" in data:
            self._write_json_file(os.path.join(world_dir, 'quests.json'), data["quests"])
        if "messages" in data:
            recent = data["messages"][-50:]
            self._write_json_file(os.path.join(world_dir, 'conversations.json'), recent)
        if "playEvents" in data:
            self._write_json_file(os.path.join(world_dir, 'play_events.json'), data["playEvents"][-200:])
        if "playScene" in data:
            self._write_json_file(os.path.join(world_dir, 'play_scene.json'), data["playScene"][-100:])
        self._send_json({"ok": True})

    def _handle_delete_world(self, world_id):
        try:
            safe_path = safe_path_join(DATA_DIR, 'worlds', world_id)
            if os.path.exists(safe_path):
                shutil.rmtree(safe_path)
            self._send_json({"ok": True})
        except ValueError:
            self._send_json({"error": "invalid world id"}, 400)

    def _handle_load_npc_memory(self, world_id, npc_id):
        mem_file = os.path.join(DATA_DIR, 'worlds', world_id, 'memories', f'{npc_id}.md')
        text = self._read_text_file(mem_file) or ''
        self._send_json({"text": text})

    def _handle_save_npc_memory(self, world_id, npc_id, data):
        data = sanitize_json_data(data)
        mem_file = os.path.join(DATA_DIR, 'worlds', world_id, 'memories', f'{npc_id}.md')
        self._write_text_file(mem_file, data.get("text", ""))
        self._send_json({"ok": True})


if __name__ == '__main__':
    os.makedirs(DATA_DIR, exist_ok=True)

    server = http.server.HTTPServer(('127.0.0.1', PORT), VectraHTTPHandler)

    # 尝试启用 SSL/TLS
    use_ssl = False
    cert_file, key_file = ensure_self_signed_cert()
    if cert_file and key_file:
        try:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert_file, key_file)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            use_ssl = True
            logger.info(f"SSL/TLS 已启用（测试用自签名证书）")
        except Exception as e:
            logger.warning(f"SSL 启用失败，回退到 HTTP: {e}")

    protocol = "https" if use_ssl else "http"
    logger.info("=" * 50)
    logger.info(f"VECTRA 服务器启动 ({'SSL' if use_ssl else 'HTTP'})")
    logger.info(f"   地址: {protocol}://localhost:{PORT}")
    logger.info(f"   数据: {DATA_DIR}")
    logger.info(f"   限流: {RATE_LIMIT_PER_MINUTE} 请求/分钟/IP")
    logger.info(f"   CSRF: 已启用（写操作需要 X-CSRF-Token）")
    if use_ssl:
        logger.info(f"   证书: {cert_file}")
        logger.info(f"   注意: 自签名证书，浏览器会提示不安全，测试使用正常")
    logger.info(f"   按 Ctrl+C 停止")
    logger.info("=" * 50)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("服务器已停止。")
        server.server_close()