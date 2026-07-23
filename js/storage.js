// ============================================================
// VECTRA — 存储层
// 自动检测后端服务器 → 用户目录文件存储
// 后端不可用时 → localStorage 回退
// ============================================================

class VectraStorage {
  constructor() {
    this.mode = 'memory';  // 'server' | 'localStorage' | 'memory'
    this._base = '';
  }

  get label() {
    return this.mode === 'server' ? '📁 文件' :
           this.mode === 'localStorage' ? '💾 本地' : '💾 内存';
  }

  // 检测后端 server.py
  async init() {
    const origin = window.location.origin;
    try {
      const res = await fetch(`${origin}/api/status`);
      if (res.ok) {
        const d = await res.json();
        if (d.mode === 'server') {
          this._base = origin;
          this.mode = 'server';
          console.log('[VectraStorage] 已连接后端服务器 →', d.dataDir);
          return;
        }
      }
    } catch (_) {}
    this.mode = 'localStorage';
    console.log('[VectraStorage] 后端不可用，使用 localStorage');
  }

  async _api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${this._base}${path}`, opts);
    return await res.json();
  }

  async _apiGET(path) { return this._api('GET', path); }
  async _apiPOST(path, body) { return this._api('POST', path, body); }

  // ===== 世界列表 =====
  async saveWorldList(worlds, currentWorld) {
    const data = { worlds, currentWorld, updatedAt: new Date().toISOString() };
    if (this.mode === 'server') {
      await this._apiPOST('/api/saveWorldList', data);
    }
    localStorage.setItem('vectra_data', JSON.stringify(data));
  }

  async loadWorldList() {
    if (this.mode === 'server') {
      try {
        const d = await this._apiGET('/api/loadWorldList');
        if (d && d.worlds) return d;
      } catch (_) {}
    }
    try {
      const r = localStorage.getItem('vectra_data');
      if (r) return JSON.parse(r);
    } catch (_) {}
    return null;
  }

  // ===== 单世界数据 =====
  async saveWorldData(worldId, data) {
    if (!worldId) return;
    if (this.mode === 'server') {
      await this._apiPOST(`/api/saveWorldData/${worldId}`, data);
    }
    localStorage.setItem(`vectra_world_${worldId}`, JSON.stringify(data));
  }

  async loadWorldData(worldId) {
    if (this.mode === 'server' && worldId) {
      try {
        const d = await this._apiGET(`/api/loadWorldData/${worldId}`);
        if (d) return d;
      } catch (_) {}
    }
    try {
      const r = localStorage.getItem(`vectra_world_${worldId}`);
      if (r) return JSON.parse(r);
    } catch (_) {}
    return null;
  }

  async deleteWorld(worldId) {
    if (this.mode === 'server') {
      try { await this._apiPOST(`/api/deleteWorld/${worldId}`); } catch (_) {}
    }
    localStorage.removeItem(`vectra_world_${worldId}`);
  }

  // ===== NPC 记忆 =====
  async saveNPCMemory(worldId, npcId, text) {
    if (this.mode === 'server') {
      await this._apiPOST(`/api/saveNPCMemory/${worldId}/${npcId}`, { text });
    }
    localStorage.setItem(`vectra_mem_${worldId}_${npcId}`, text);
  }

  async loadNPCMemory(worldId, npcId) {
    if (this.mode === 'server') {
      try {
        const d = await this._apiGET(`/api/loadNPCMemory/${worldId}/${npcId}`);
        if (d && d.text !== undefined) return d.text;
      } catch (_) {}
    }
    try {
      return localStorage.getItem(`vectra_mem_${worldId}_${npcId}`) || '';
    } catch (_) { return ''; }
  }

  // ===== API 设置 =====
  saveSettings(s) {
    localStorage.setItem('vectra_settings', JSON.stringify(s));
  }

  loadSettings() {
    try {
      const r = localStorage.getItem('vectra_settings');
      if (r) return JSON.parse(r);
    } catch (_) {}
    return { endpoint: 'https://api.openai.com/v1', key: '', model: '', temperature: 0.8, maxTokens: 4096 };
  }
}

const vectraStorage = new VectraStorage();