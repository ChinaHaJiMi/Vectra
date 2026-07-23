#!/usr/bin/env python3
"""
VECTRA — 后端服务器
同时提供：静态文件服务 + 文件系统读写 API
解决浏览器 File System Access API 不兼容问题
"""

import http.server
import json
import os
import sys
import urllib.parse

# === 配置 ===
PORT = 8080
DATA_DIR = os.path.join(os.path.expanduser("~"), "VectraData")

# === 文件系统 API 处理 ===

class VectraHTTPHandler(http.server.SimpleHTTPRequestHandler):
    """扩展 SimpleHTTPRequestHandler，添加 /api/ 路由"""

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/status':
            self._send_json({"mode": "server", "dataDir": DATA_DIR, "ok": True})
        elif parsed.path == '/api/loadWorldList':
            self._handle_load_world_list()
        elif parsed.path.startswith('/api/loadWorldData/'):
            world_id = parsed.path.split('/api/loadWorldData/')[1]
            self._handle_load_world_data(world_id)
        elif parsed.path.startswith('/api/loadNPCMemory/'):
            parts = parsed.path.split('/api/loadNPCMemory/')[1].split('/')
            if len(parts) == 2:
                self._handle_load_npc_memory(parts[0], parts[1])
            else:
                self._send_json({"error": "invalid path"}, 400)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b'{}'

        if parsed.path == '/api/saveWorldList':
            self._handle_save_world_list(json.loads(body))
        elif parsed.path.startswith('/api/saveWorldData/'):
            world_id = parsed.path.split('/api/saveWorldData/')[1]
            self._handle_save_world_data(world_id, json.loads(body))
        elif parsed.path.startswith('/api/saveNPCMemory/'):
            parts = parsed.path.split('/api/saveNPCMemory/')[1].split('/')
            if len(parts) == 2:
                self._handle_save_npc_memory(parts[0], parts[1], json.loads(body))
            else:
                self._send_json({"error": "invalid path"}, 400)
        elif parsed.path.startswith('/api/deleteWorld/'):
            world_id = parsed.path.split('/api/deleteWorld/')[1]
            self._handle_delete_world(world_id)
        else:
            self._send_json({"error": "not found"}, 404)

    # ---- 工具 ----
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'))

    def _ensure_dir(self, path):
        os.makedirs(path, exist_ok=True)

    def _read_json_file(self, filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def _write_json_file(self, filepath, data):
        self._ensure_dir(os.path.dirname(filepath))
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _read_text_file(self, filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return f.read()
        except FileNotFoundError:
            return None

    def _write_text_file(self, filepath, text):
        self._ensure_dir(os.path.dirname(filepath))
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(text)

    # ---- API ----
    def _handle_load_world_list(self):
        data = self._read_json_file(os.path.join(DATA_DIR, 'worlds.json'))
        self._send_json(data or {"worlds": [], "currentWorld": None})

    def _handle_save_world_list(self, data):
        self._write_json_file(os.path.join(DATA_DIR, 'worlds.json'), data)
        self._send_json({"ok": True})

    def _handle_load_world_data(self, world_id):
        world_dir = os.path.join(DATA_DIR, 'worlds', world_id)
        meta = self._read_json_file(os.path.join(world_dir, 'meta.json'))
        npcs = self._read_json_file(os.path.join(world_dir, 'npcs.json'))
        quests = self._read_json_file(os.path.join(world_dir, 'quests.json'))
        msgs = self._read_json_file(os.path.join(world_dir, 'conversations.json'))
        if meta:
            self._send_json({
                "phase": meta.get("phase", 1),
                "bible": meta.get("bible", {"lore": "", "laws": [], "era": ""}),
                "npcs": npcs or [],
                "quests": quests or [],
                "messages": msgs or [],
                "npcsConfirmed": meta.get("npcsConfirmed", False),
                "questsConfirmed": meta.get("questsConfirmed", False),
            })
        else:
            self._send_json(None)

    def _handle_save_world_data(self, world_id, data):
        world_dir = os.path.join(DATA_DIR, 'worlds', world_id)
        self._ensure_dir(world_dir)
        self._write_json_file(os.path.join(world_dir, 'meta.json'), {
            "phase": data.get("phase", 1),
            "bible": data.get("bible", {"lore": "", "laws": [], "era": ""}),
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
        self._send_json({"ok": True})

    def _handle_delete_world(self, world_id):
        world_dir = os.path.join(DATA_DIR, 'worlds', world_id)
        import shutil
        if os.path.exists(world_dir):
            shutil.rmtree(world_dir)
        self._send_json({"ok": True})

    def _handle_load_npc_memory(self, world_id, npc_id):
        mem_file = os.path.join(DATA_DIR, 'worlds', world_id, 'memories', f'{npc_id}.md')
        text = self._read_text_file(mem_file) or ''
        self._send_json({"text": text})

    def _handle_save_npc_memory(self, world_id, npc_id, data):
        mem_file = os.path.join(DATA_DIR, 'worlds', world_id, 'memories', f'{npc_id}.md')
        self._write_text_file(mem_file, data.get("text", ""))
        self._send_json({"ok": True})


if __name__ == '__main__':
    # 确保数据目录存在
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"⬡ VECTRA 服务器启动")
    print(f"   地址: http://localhost:{PORT}")
    print(f"   数据: {DATA_DIR}")
    print(f"   按 Ctrl+C 停止")

    server = http.server.HTTPServer(('0.0.0.0', PORT), VectraHTTPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止。")
        server.server_close()