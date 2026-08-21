// ============================================================
// VECTRA — AI NPC 模拟系统 · 完整版
// 创世模式 + 游玩模式 + NPC AI对话 + 双记忆 + 事件日志
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ===== 状态 =====
  const state = {
    worlds: [], currentWorld: null, phase: 1,
    bible: { lore: '', laws: [], era: '' },
    player: { name: '', role: '', backstory: '' },
    npcs: [], quests: [], messages: [],
    // 用于给 NPC 分配初始位置的地点池
    _locationPool: ['📍 酒馆', '📍 广场', '📍 集市', '📍 铁匠铺', '📍 教堂', '📍 港口', '📍 城堡', '📍 图书馆', '📍 花园', '📍 城墙'],
    settings: { endpoint: 'https://api.openai.com/v1', key: '', model: '', temperature: 0.8, maxTokens: 4096, autoRate: 5, directorEndpoint: '', directorKey: '', directorModel: '' },
    launched: false,
    mode: 'creation',
    play: {
      clock: { day:1, hour:0, minute:0 },
      speed: 64,
      running: true,
      events: [],
      scene: [],
      activeNpc: null,
      location: '📍 世界地图',
      mode: 'auto',        // 对话模式: 'auto' | 'passive'
      nextAutoAt: 0,       // 下次允许自动交流的时间戳
      typingPause: false,  // 玩家正在编辑消息时暂停世界
    },
  };

  // ===== DOM 引用 =====
  const el = {
    worldList: $('#world-list'), btnNewWorld: $('#btn-new-world'),
    btnSettings: $('#btn-settings'), btnStorage: $('#btn-storage'),
    storageIndicator: $('#storage-indicator'),
    phaseSteps: () => $$('.phase-step'), msgList: $('#message-list'),
    chatInput: $('#chat-input'), btnSend: $('#btn-send'), btnConfirm: $('#btn-confirm'),
    bibleBody: $('#bible-body'), rosterBody: $('#roster-body'), questBody: $('#quest-body'), launchBody: $('#launch-body'),
    tabBtns: () => $$('.tab-btn'), tabContents: () => $$('.tab-content'), sowerStatus: $('.sower-status'),
    playPanel: $('#play-panel'), mainPanel: $('#main-panel'), rightPanel: $('#right-panel'),
    pworldName: $('#pworld-name'), pclock: $('#pclock'), pstatus: $('#pstatus'), plevel: $('#plevel'), pplayer: $('#pplayer'),
    pnpcList: $('#pnpc-list'), pscene: $('#pscene'), pevents: $('#pevents'),
    pinput: $('#pinput'), psend: $('#psend'), plocation: $('#plocation'), pactiveNpc: $('#pactive-npc'),
    spdBtns: () => $$('.spd[data-s]'), backBtn: $('#btn-back-creation'), btnPlayMode: $('#btn-play-mode'), btnWorldBroadcast: $('#btn-world-broadcast'),
    settingsAutoRate: $('#settings-autorate'),
    modalSettings: $('#modal-settings'), settingsEndpoint: $('#settings-endpoint'), settingsKey: $('#settings-key'),
    settingsModel: $('#settings-model'), settingsTemp: $('#settings-temp'), settingsTempVal: $('#settings-temp-val'),
    settingsMaxTokens: $('#settings-maxtokens'), btnSettingsTest: $('#btn-settings-test'), btnSettingsSave: $('#btn-settings-save'), btnSettingsClose: $('#btn-settings-close'),
    settingsDirEndpoint: $('#settings-dir-endpoint'), settingsDirKey: $('#settings-dir-key'), settingsDirModel: $('#settings-dir-model'),
    modalNpc: $('#modal-npc'), npcName: $('#npc-name'), npcKind: $('#npc-kind'), npcAge: $('#npc-age'), npcRole: $('#npc-role'),
    npcPersonality: $('#npc-personality'), npcBackstory: $('#npc-backstory'),
    npcSpeechStyle: $('#npc-speech-style'), npcVerbalTic: $('#npc-verbal-tic'), npcHabitAction: $('#npc-habit-action'),
    btnNpcSave: $('#btn-npc-save'), btnNpcClose: $('#btn-npc-close'),
    modalBible: $('#modal-bible'), bibleLore: $('#bible-lore'), bibleLaws: $('#bible-laws'), bibleEra: $('#bible-era'),
    btnBibleSave: $('#btn-bible-save'), btnBibleClose: $('#btn-bible-close'),
    modalPlayer: $('#modal-player'), playerName: $('#player-name'), playerRole: $('#player-role'), playerBackstory: $('#player-backstory'),
    btnPlayerSave: $('#btn-player-save'), btnPlayerClose: $('#btn-player-close'),
    modalQuest: $('#modal-quest'), questType: $('#quest-type'), questName: $('#quest-name'), questDesc: $('#quest-desc'),
    btnQuestSave: $('#btn-quest-save'), btnQuestClose: $('#btn-quest-close'),
    modalMemory: $('#modal-memory'), memoryShort: $('#memory-short'), memoryLong: $('#memory-long'),
    memoryNpcLabel: $('#memory-npc-label'), btnMemorySave: $('#btn-memory-save'), btnMemoryClose: $('#btn-memory-close'),
    memoryEntries: $('#memory-entries'), memoryTagFilter: $('#memory-tag-filter'),
    memoryNewTags: $('#memory-new-tags'), memoryNewContent: $('#memory-new-content'),
    memoryNewImp: $('#memory-new-imp'), memoryAddBtn: $('#memory-add-btn'),
  };

  // ===== 存储封装（防抖：500ms 内多次调用只执行最后一次）=====
  let _saveTimer = null;
  async function storageSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      _saveTimer = null;
      try {
        await vectraStorage.saveWorldList(state.worlds, state.currentWorld);
        await vectraStorage.saveWorldData(state.currentWorld, {
          phase: state.phase, bible: state.bible, player: state.player, npcs: state.npcs, quests: state.quests,
          messages: state.messages.slice(-100),
          playEvents: state.play.events.slice(-200),
          playScene: state.play.scene.slice(-100),
          playClock: state.play.clock,
          playMode: state.play.mode,
          launched: state.launched,
        });
        el.storageIndicator.textContent = vectraStorage.label;
      } catch(e) { console.warn('[storageSave]', e); }
    }, 500);
  }

  async function storageLoadWorld(id) {
    const d = await vectraStorage.loadWorldData(id);
    if (d) {
      state.phase = d.phase || 1; state.bible = d.bible || { lore:'', laws:[], era:'' };
      state.player = d.player || { name:'', role:'', backstory:'' };
      state.npcs = d.npcs || []; state.quests = d.quests || []; state.messages = d.messages || [];
      state.launched = d.launched || false;
      state.play.events = d.playEvents || [];
      state.play.clock = _normalizeClock(d.playClock);
      state.play.scene = d.playScene || [];
      state.play.mode = d.playMode === 'passive' ? 'passive' : 'auto';
    } else {
      state.phase = 1; state.bible = { lore:'', laws:[], era:'' };
      state.player = { name:'', role:'', backstory:'' };
      state.npcs = []; state.quests = []; state.messages = [];
      state.launched = false;
      state.play.events = []; state.play.clock = { day:1, hour:0, minute:0 };
      state.play.scene = [];
      state.play.mode = 'auto';
    }
  }

  function timestamp() { return new Date().toTimeString().slice(0, 8); }

  // 时钟归正：把可能被写坏的 day/hour/minute 重新归一化（防分钟>=60）
  function _normalizeClock(c) {
    c = c || {};
    let day = Number(c.day) || 1;
    let hour = Number(c.hour) || 0;
    let minute = Number(c.minute) || 0;
    hour += Math.floor(minute / 60);
    minute = minute % 60;
    day += Math.floor(hour / 24);
    hour = hour % 24;
    return { day: Math.max(1, day), hour, minute };
  }

  // ===== 安全工具（使用 Sanitize 模块） =====
  function _isSafeUrl(urlString) {
    return Sanitize.url(urlString) !== null;
  }

  function _sanitizeInput(text, maxLen) {
    return Sanitize.text(text, maxLen || 2000);
  }

  // ===== 工具：LLM调用 =====
  async function callLLM(messages, systemExtra) {
    const s = state.settings;
    if (!s.key) return '⚠️ 未配置 API Key。';
    if (!s.model) return '⚠️ 未配置模型 ID。';
    if (!_isSafeUrl(s.endpoint)) return '⚠️ API 端点地址不合法，请检查设置。';
    const msgs = [{ role: 'system', content: systemExtra || '' }, ...messages];
    try {
      const endpoint = s.endpoint.replace(/\/+$/, '');
      const res = await fetch(endpoint + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
        body: JSON.stringify({ model: s.model, messages: msgs, temperature: s.temperature, max_tokens: s.maxTokens }),
      });
      if (!res.ok) {
        try { await res.text(); } catch (_) {}
        return '❌ API 错误 (' + res.status + ')。';
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '（没有回复）';
    } catch(e) { return '❌ 网络错误，请检查网络连接或 API 端点地址。'; }
  }

  // ===== 导演 AI：决定这次由谁回话 =====
  // 使用独立 API（未配置时回退主 API）；失败时返回 null 由调用方回退
  async function callDirector(speakerLabel, message, sceneContext) {
    const s = state.settings;
    const dEndpoint = s.directorEndpoint || s.endpoint;
    const dKey = s.directorKey || s.key;
    const dModel = s.directorModel || s.model;
    if (!dKey || !dModel || !_isSafeUrl(dEndpoint)) return null;

    const npcList = state.npcs.filter(n => n.online !== false).map(n =>
      `- ${n.kind === 'plot' ? '[剧情角色]' : '[紧要角色]'} ${n.name}（${n.role||'普通人'} · 性格：${n.personality||'一般'} · 位置：${n.location||'世界'}）`
    ).join('\n');

    const prompt = `你是这个 AI 世界的对话导演。由你决定哪些角色该对最新消息做出回应，其余保持沉默。
可回应的角色：
${npcList}

最近发生的场景：
${sceneContext}

最新消息：${speakerLabel}：${message}

规则：
- 一般闲聊、面向全体的消息：只从 [紧要角色] 里选最相关的 0~2 个回应
- [剧情角色] 只在消息点名、或与其故事线直接相关时才允许回应
- 消息点名了某人就只让被点名者回应
- 无关的角色一律沉默，宁缺毋滥
只输出 JSON：{"reply": ["角色名", ...]}`;

    try {
      const endpoint = dEndpoint.replace(/\/+$/, '');
      const res = await fetch(endpoint + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dKey },
        body: JSON.stringify({ model: dModel, messages: [{ role: 'system', content: '你只输出 JSON，不要有多余文字。' }, { role: 'user', content: prompt }], temperature: 0.2, max_tokens: 200 }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const m = text.match(/\{[\s\S]*?\}/);
      if (!m) return null;
      const obj = JSON.parse(m[0]);
      const names = Array.isArray(obj.reply) ? obj.reply : [];
      return names.map(n => _sanitizeInput(String(n).trim(), 50)).filter(Boolean);
    } catch(e) { return null; }
  }

  // 导演选人：返回 { repliers, directed }；导演不可用/无人选时回退到紧要 NPC
  async function _pickRepliers(speakerLabel, message, sceneContext) {
    const names = await callDirector(speakerLabel, message, sceneContext);
    if (names && names.length) {
      // 容错匹配：精确名 / 包含关系
      const matches = state.npcs.filter(n => n.online !== false &&
        names.some(nm => nm === n.name || nm.includes(n.name) || n.name.includes(nm)));
      if (matches.length) return { repliers: matches, directed: true };
    }
    return { repliers: state.npcs.filter(n => n.online !== false && n.kind !== 'plot'), directed: false };
  }

  // ===== 创世模式 =====
  function buildSystemPrompt() {
    const b = state.bible;
    const npcS = state.npcs.map(n => `- ${n.name}（${n.role||''}）${n.personality?'：'+n.personality:''}`).join('\n');
    const qS = state.quests.map(q => `- [${q.type}] ${q.name}：${q.desc||''}`).join('\n');
    let p = `# VECTRA 世界系统\n你是「播种者」(THE SOWER)——AI 游戏世界创造者。`;
    if (b.lore) p += `\n## 世界观\n${b.lore}`;
    if (b.laws.length) p += `\n## 法则\n${b.laws.map(l=>`- ${l}`).join('\n')}`;
    if (b.era) p += `\n## 纪元\n${b.era}`;
    if (state.npcs.length) p += `\n## 居民\n${npcS}`;
    if (state.quests.length) p += `\n## 往事\n${qS}`;
    p += `\n## 阶段 ${state.phase}/4：${['世界设定书','居民名册','往事蓝图','启动世界'][state.phase-1]}`;
    p += `\n## 结构化输出：用 [DRAFT]{...}[/DRAFT] 包裹 JSON。阶段1:{"bible":{"lore":"...","laws":[...],"era":"..."}} 阶段2:{"npcs":[...]} 阶段3:{"quests":[...]}`;
    return p;
  }

  function parseDraft(reply) {
    const m = reply.match(/\[DRAFT\]\s*([\s\S]*?)\s*\[\/DRAFT\]/);
    if (!m) return null;
    try { return JSON.parse(m[1].trim()); } catch(_) { return null; }
  }

  function applyDraft(data) {
    let c = false;
    if (data.bible) {
      if (data.bible.lore) state.bible.lore = _sanitizeInput(data.bible.lore, 50000);
      if (data.bible.laws) state.bible.laws = data.bible.laws.map(l => _sanitizeInput(l, 2000)).filter(Boolean);
      if (data.bible.era) state.bible.era = _sanitizeInput(data.bible.era, 2000);
      c = true;
    }
    if (data.npcs) {
      for (const n of data.npcs) {
        const idx = state.npcs.length;
        state.npcs.push({
          id: 'n' + Date.now() + Math.random().toString(36).slice(2,6),
          name: _sanitizeInput(n.name, 100) || '未命名',
          kind: n.kind === 'plot' ? 'plot' : 'key',
          role: _sanitizeInput(n.role, 200),
          personality: _sanitizeInput(n.personality, 2000),
          age: _sanitizeInput(n.age, 50),
          backstory: _sanitizeInput(n.backstory, 5000),
          icon: ['🧙','⚔️','🏹','🔮','🛡️','🧝','⛏️','📜'][idx % 8],
          location: state._locationPool[idx % state._locationPool.length],
        });
      }
      c = true;
    }
    if (data.quests) {
      for (const q of data.quests) {
        state.quests.push({
          id: 'q' + Date.now() + Math.random().toString(36).slice(2,6),
          name: _sanitizeInput(q.name, 200) || '未命名',
          type: _sanitizeInput(q.type, 50) || '主线',
          desc: _sanitizeInput(q.desc, 5000),
          time: timestamp(),
        });
      }
      c = true;
    }
    if (c) { renderRightPanel(); storageSave(); el.btnConfirm.style.display = 'inline-block'; }
  }

  function addMessage(type, content) {
    state.messages.push({ type, content: _sanitizeInput(content, 50000) });
    renderMessages();
    storageSave();
  }

  let isProcessing = false;
  async function handleSend() {
    if (isProcessing) return;
    const text = _sanitizeInput(el.chatInput.value.trim(), 5000);
    if (!text) return;
    el.chatInput.value = ''; addMessage('user', text);
    if (!state.settings.key || !state.settings.model) { addMessage('sower', '⚠️ 请配置 API Key 和模型。'); return; }
    isProcessing = true; el.btnSend.disabled = true; el.btnSend.textContent = '思考中…';
    try {
      const reply = await callLLM([{ role:'user', content: text }], buildSystemPrompt());
      const clean = reply.replace(/\[DRAFT\][\s\S]*?\[\/DRAFT\]/g, '').trim();
      addMessage('sower', clean || reply);
      const draft = parseDraft(reply);
      if (draft) applyDraft(draft);
      renderRightPanel();
      if (state.phase===1 && state.bible.lore) el.btnConfirm.style.display = 'inline-block';
      else if (state.phase===2 && state.npcs.length>0) el.btnConfirm.style.display = 'inline-block';
      else if (state.phase===3 && state.quests.length>0) el.btnConfirm.style.display = 'inline-block';
      storageSave();
    } catch(e) { addMessage('sower', '❌ 错误'); }
    isProcessing = false; el.btnSend.disabled = false; el.btnSend.textContent = '发送'; el.chatInput.focus();
  }

  function advancePhase(delta) {
    if (delta === undefined) delta = 1;
    const newPhase = state.phase + delta;
    if (newPhase >= 1 && newPhase <= 4) {
      state.phase = newPhase;
      renderAll();
      switchTab(['bible','roster','quest','launch'][state.phase-1]);
      storageSave();
    }
  }

  // ===== 切换模式 =====
  function switchMode(mode) {
    state.mode = mode;
    if (mode === 'play') {
      el.mainPanel.classList.add('panel-hidden');
      el.rightPanel.classList.add('panel-hidden');
      el.playPanel.classList.remove('panel-hidden');
      renderPlayMode();
      startClock();
      startAutoLoop();
    } else {
      el.playPanel.classList.add('panel-hidden');
      el.mainPanel.classList.remove('panel-hidden');
      el.rightPanel.classList.remove('panel-hidden');
      stopAutoLoop();
      state.play.typingPause = false;
    }
  }

  // ===== 游玩模式渲染 =====
  function formatClock() {
    const c = state.play.clock;
    return `📅 第${c.day}日 ${String(c.hour).padStart(2,'0')}:${String(c.minute).padStart(2,'0')}`;
  }

  function renderPlayStatus() {
    el.pworldName.textContent = state.worlds.find(w=>w.id===state.currentWorld)?.name || '世界';
    el.pclock.textContent = formatClock();
    el.pstatus.textContent = state.play.running ? '▶ LIVE' : '⏸ PAUSED';
    el.pstatus.className = state.play.running ? 'status-live' : 'status-paused';
    el.plevel.textContent = 'Lv.' + (state.npcs.length + state.quests.length + 1);
    el.pplayer.textContent = (state.player && state.player.name) ? state.player.name : '旅人';
  }

  function renderNpcList() {
    el.pnpcList.innerHTML = state.npcs.map((n,i) =>
      `<div class="npc-play-item" data-idx="${i}">
        <span class="dot" style="background:${n.online!==false?'var(--green)':'var(--text-muted)'}"></span>
        <span>${n.kind==='plot'?'📖':'⭐'} ${Sanitize.htmlEncode(n.name)}</span>
        <span class="npc-loc" style="margin-left:auto;font-size:10px;color:var(--text-muted);">${n.location?Sanitize.htmlEncode(n.location):''}</span>
      </div>`
    ).join('');
    // 居民列表仅作展示，直接输入即与在场所有人对话
    el.pactiveNpc.textContent = '💬 直接输入，所有在场 NPC 都会回应';
  }

  function addSceneMsg(type, content) {
    state.play.scene.push({ type, content: _sanitizeInput(content, 10000), time: formatClock() });
    renderScene();
  }

  // 把 NPC/玩家回复里的「（神态/动作）」 解析为可样式化
  function _formatSceneContent(s) {
    const safe = Sanitize.htmlEncode(s.content);
    if (s.type !== 'npc' && s.type !== 'player') return safe;
    const actRe = /^(（[^）]*\)|\([^)]*\))/;  // 前导一个（…）或 (…)
    let actHTML = '';
    let rest = safe;
    let m;
    while ((m = rest.match(actRe))) {
      actHTML += `<span class="act">${m[1]}</span>`;
      rest = rest.slice(m[0].length).trim();
      if (!rest) break;
    }
    if (rest) return actHTML + `<span class="speech">${rest}</span>`;
    return actHTML;
  }

  function renderScene() {
    el.pscene.innerHTML = state.play.scene.length === 0
      ? '<div class="scene-empty">点击居民或事件开始互动</div>'
      : state.play.scene.map(s => `<div class="scene-msg ${s.type}">${_formatSceneContent(s)}</div>`).join('');
    el.pscene.scrollTop = el.pscene.scrollHeight;
  }

  function addEvent(desc, npcName) {
    const entry = { time: formatClock(), desc: _sanitizeInput(desc, 2000), npc: _sanitizeInput(npcName||'', 100) || '', id: Date.now() };
    state.play.events.push(entry);
    renderEvents();
    storageSave();
  }

  function renderEvents() {
    el.pevents.innerHTML = state.play.events.slice(-100).reverse().map(e =>
      `<div class="event-entry" data-id="${e.id}">
        <div class="etime">${Sanitize.htmlEncode(e.time)}${e.npc?' · '+Sanitize.htmlEncode(e.npc):''}</div>
        <div class="edesc">${Sanitize.htmlEncode(e.desc)}</div>
      </div>`
    ).join('');
    el.pevents.querySelectorAll('.event-entry').forEach(entry => {
      entry.addEventListener('click', () => {
        const desc = entry.querySelector('.edesc')?.textContent || '';
        addSceneMsg('event', '📋 ' + desc);
        addEvent('玩家查看了事件: ' + desc.slice(0, 30));
      });
    });
  }

  function renderPlayMode() {
    renderPlayStatus();
    renderNpcList();
    renderScene();
    renderEvents();
    if (el.btnPlayMode) {
      const isAuto = state.play.mode === 'auto';
      el.btnPlayMode.textContent = isAuto ? '🔄 自动' : '👁 被动';
      el.btnPlayMode.classList.toggle('active', isAuto);
      el.btnPlayMode.title = isAuto ? '自动对话：NPC会主动交流（编辑消息时自动暂停）' : '被动对话：仅当玩家说话/行动时NPC跟进';
    }
    if (state.play.events.length === 0) {
      addEvent('世界已启动。冒险开始。');
      addSceneMsg('narrator', '世界在你面前展开。选择一位居民开始互动，或输入指令。');
    }
  }

  // ===== NPC AI 对话 =====
  async function _replyNpc(npc, userMsg, method) {
    const nowClock = formatClock();
    const npcLoc = npc.location || state.play.location;
    const playerName = (state.player && state.player.name) || '旅人';
    const playerDesc = (state.player && state.player.role) ? `（${state.player.role}）` : '';

    const methodHint = method ? `（对方通过${method}联系你）` : '（对方就在你面前）';
    const kindHint = npc.kind === 'plot'
      ? '你是与这个世界核心故事线相关的剧情角色，对世界的秘密有所了解。'
      : '你是这个世界的重要人物，居民们对你很熟悉。';
    const speechStyle = npc.speechStyle || '自然口语，说话不做作';
    const verbalTic = npc.verbalTic ? '（夹杂习惯用语：' + npc.verbalTic + '）' : '';
    const habitAction = npc.habitAction ? '习惯动作：' + npc.habitAction : '习惯动作：无';

    // 结构化记忆检索 → 只喂相关片段
    const keywords = vectraStorage._extractKeywords(userMsg);
    const qTags = [playerName, npcLoc, npc.name];
    const relevant = await vectraStorage.queryNPCMemory(state.currentWorld, npc.id, {
      tags: qTags, keywords, maxChars: 1500
    }) || [];
    const shortMem = npc._shortMem || '';
    const longMemBlock = relevant.length
      ? '相关记忆：\n' + relevant.map(e => `- [${e.time || formatClock()}][${(e.tags||[]).join(',')}] ${e.content}`).join('\n')
      : '暂无直接相关记忆，但你可以结合你的经验判断。';

    const systemP = `## 世界背景
${state.bible.lore || '一个普通的现代世界'}
纪元：${state.bible.era || '当代'}
法则：${(state.bible.laws || []).join('；') || '无特殊'}

## 你的身份
你是「${npc.name}」，${npc.role || '一个普通人'}。
${kindHint}
性格：${npc.personality || '和大多数人差不多'}
经历：${npc.backstory || '过着平凡的生活'}

## 你的行为契约
- 说话风格：${speechStyle}
${verbalTic}
- ${habitAction}
- 每次回复先做一个小动作表达神态，再开口说话

## 你记得的事
${shortMem ? '最近发生的事：\n' + shortMem : '最近没什么特别的。'}
${longMemBlock ? '\n' + longMemBlock : ''}

## 现在的场景
当前时间：${nowClock}
你的位置：${npcLoc}
${methodHint}

## 扮演规则
1. 你就是${npc.name}，第一人称「我」，口语化、自然，活人感，别像念设定
2. 你的性格「${npc.personality || '和大多数人差不多'}」决定你怎么想、怎么看、怎么说话 —— 别丢人物感
3. 先回忆再开口：你的记忆里有相关线索时，主动引用（"上次你…"，"那件事之后…"）
4. 回复格式：（神态/动作）+ 台词，例如：（正了正帽檐）这个嘛…你说的我也想过
5. 对反常的事觉得奇怪，不知道就说不知道，别硬编
6. 对方消息里的「我」是对方自称，是对方的言行，不是你自己
7. 80字以内，一句话说完也行，别长篇大论
8. 不要提及你是AI、NPC或语言模型
9. 注意时间${nowClock}，你的状态随时间变化`;

    const sceneContext = state.play.scene.slice(-10).map(s =>
      `[${s.time || nowClock}][${s.type}] ${s.content}`
    ).join('\n');

    addSceneMsg('narrator', npc.name + ' 正在思考…');

    // 身份锁定收缩到一条 user 前缀，避免重复浪费 token
    const identityLock = `你是「${npc.name}」，不是「${playerName}」，也不是任何其他人。` +
      ` 正在和你对话的是「${playerName}」${playerDesc}，他不是你，你不叫${playerName}。` +
      ` 所有第一人称「我」都是${playerName}的言行，不是你的。`;

    const reply = await callLLM([
      { role: 'system', content: identityLock },
      { role: 'user', content: `${playerName}对你说：${userMsg}\n\n刚才场景：\n${sceneContext}` }
    ], systemP);

    state.play.scene = state.play.scene.filter(s => !s.content.includes('正在思考…'));

    const escNpc = npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escPlayer = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cleanReply = reply
      .replace(/^(你：|NPC：)/, '')
      .replace(new RegExp('^' + escPlayer + '：'), '')
      .replace(new RegExp('^' + escNpc + '：'), '')
      .trim();
    const prefix = method ? `${npc.name}（${npcLoc} · ${method}）：` : `${npc.name}（${npcLoc}）：`;
    addSceneMsg('npc', prefix + cleanReply);
    addEvent(npc.name + (method ? `通过${method}` : '') + ' 回话了', npc.name);

    // 短记忆累积 + 触发巩固
    _appendShortMem(npc, `${playerName}说：${userMsg.slice(0, 30)}`);
    if (npc._shortMem && npc._shortMem.length > 450) {
      await _tryConsolidate(npc);
    }
    storageSave();
  }

  // 短记忆追加&裁剪
  function _appendShortMem(npc, line) {
    const prev = npc._shortMem || '';
    npc._shortMem = (prev ? prev + '\n' : '') + `[${formatClock()}] ${line}`;
    if (npc._shortMem.length > 500) npc._shortMem = npc._shortMem.slice(-500);
  }

  // 尝试把短记忆巩固到长记忆库
  async function _tryConsolidate(npc) {
    if (!npc.id || !state.currentWorld) return;
    const playerName = (state.player && state.player.name) || '';
    const entries = await vectraStorage.consolidateShortMemory(state.currentWorld, npc.id, npc._shortMem, {
      callLLM, npcName: npc.name, playerName
    });
    if (entries && entries.length) {
      addEvent(npc.name + ' 的记忆整理：' + entries.length + ' 条新长记忆');
      npc._shortMem = '';   // 巩固后清空短记忆
    }
  }

  // ===== Auto 模式：NPC 主动交流 =====
  // 让 NPC 基于当前场景主动开口说一句（不等待玩家输入）
  async function _npcAutoSay(npc, targetNpc) {
    const nowClock = formatClock();
    const npcLoc = npc.location || state.play.location;
    const shortMem = npc._shortMem || '';
    const playerName = (state.player && state.player.name) || '旅人';
    const kindHint = npc.kind === 'plot'
      ? '你是与这个世界核心故事线相关的剧情角色，对世界的秘密有所了解。'
      : '你是这个世界的重要人物，居民们对你很熟悉。';
    const speechStyle = npc.speechStyle || '自然口语，说话不做作';
    const verbalTic = npc.verbalTic ? '（夹杂习惯用语：' + npc.verbalTic + '）' : '';
    const habitAction = npc.habitAction ? '习惯动作：' + npc.habitAction : '习惯动作：无';

    const targetHint = targetNpc
      ? `你身边有「${targetNpc.name}」，考虑和 ta 聊几句。`
      : '你独自待着，自然做些自言自语。';

    // 结构化记忆检索
    const keywordQuery = targetNpc ? targetNpc.name : npc.name;
    const relevant = await vectraStorage.queryNPCMemory(state.currentWorld, npc.id, {
      tags: [npcLoc, npc.name, targetNpc ? targetNpc.name : null].filter(Boolean),
      keywords: vectraStorage._extractKeywords(keywordQuery), maxChars: 1200
    }) || [];
    const longMemBlock = relevant.length
      ? '相关记忆：\n' + relevant.map(e => `- [${e.time || ''}] ${e.content}`).join('\n')
      : '暂无直接相关记忆。';

    const systemP = `## 世界背景
${state.bible.lore || '一个普通的现代世界'}
纪元：${state.bible.era || '当代'}

## 你的身份
你是「${npc.name}」，${npc.role || '一个普通人'}。
${kindHint}
性格：${npc.personality || '和大多数人差不多'}
经历：${npc.backstory || '过着平凡的生活'}

## 你的行为契约
- 说话风格：${speechStyle}
${verbalTic}
- ${habitAction}
- 每次回复先做一个小动作表达神态，再开口说话

## 你记得的事
${shortMem ? '最近发生的事：\n' + shortMem : '最近没什么特别的。'}
${longMemBlock}

## 现在的场景
当前时间：${nowClock}
你的位置：${npcLoc}
${targetHint}

## 扮演规则
1. 你就是${npc.name}，活在这个世界的人，用第一人称「我」口语化
2. 你的性格「${npc.personality || '和大多数人差不多'}」决定你怎么想怎么说
3. 先回忆再开口：你的记忆里有相关线索时，主动引用
4. 回复格式：（神态/动作）+ 台词，例如：（伸了个懒腰）看看天，真晴。
5. 主动开口，说一句自然的话：寒暄、问事、聊近况
6. 字数控制在80字以内，一句话说完就好
7. 不要提及你是AI、NPC或语言模型
9. 注意时间${nowClock}，你的状态随时间变化`;

    const sceneContext = state.play.scene.slice(-10).map(s =>
      `[${s.time || nowClock}][${s.type}] ${s.content}`
    ).join('\n');

    const identityLock = `你是「${npc.name}」，不是任何其他人，包括「${targetNpc ? targetNpc.name : playerName}」。` +
      (targetNpc ? `「${targetNpc.name}」是你的对话对象，不是你自己。` : '');

    const reply = await callLLM([
      { role: 'system', content: identityLock },
      { role: 'user', content: '场景最近对话：\n' + sceneContext + '\n\n现在没有人点名你，你自然地主动开口回应场景。' }
    ], systemP);

    const escName = npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return reply.replace(/^(你：|NPC：|)/, '').replace(new RegExp('^' + escName + '：'), '').trim();
  }

  let _autoBusy = false;
  async function _autoInteract() {
    if (_autoBusy) return;
    _autoBusy = true;
    try {
      const online = state.npcs.filter(n => n.online !== false && n.kind !== 'plot');
      if (online.length < 2) return;

      // 严格地点限制：只有位于同一地点的 NPC 才会互相交谈
      const byLoc = {};
      online.forEach(n => { const k = n.location || '📍 世界地图'; (byLoc[k] = byLoc[k] || []).push(n); });
      let pool = null;
      for (const g of Object.values(byLoc)) { if (g.length >= 2) { pool = g; break; } }
      if (!pool) return;

      const ia = Math.floor(Math.random() * pool.length);
      let ib = Math.floor(Math.random() * (pool.length - 1));
      if (ib >= ia) ib++;
      const a = pool[ia], b = pool[ib];
      const locHint = a.location || state.play.location;

      addSceneMsg('narrator', '💬 ' + a.name + ' 与 ' + b.name + ' 在' + locHint + '闲聊起来…');
      const line = await _npcAutoSay(a, b);
      if (!line || /^(⚠️|❌)/.test(line)) {
        state.play.scene = state.play.scene.filter(s => !s.content.includes('闲聊起来'));
        return;
      }
      addSceneMsg('npc', a.name + '（' + locHint + '）：' + line);
      addEvent(a.name + ' 主动和 ' + b.name + ' 搭话', a.name);
      // 对方接话
      await _replyNpc(b, a.name + ' 主动对你说："' + line.slice(0, 40) + '"——你自然地接话回应。', null);
    } finally {
      _autoBusy = false;
    }
  }

  let _sendBusy = false;
  async function handlePlaySend() {
    if (_sendBusy) return;
    _sendBusy = true;
    try {
    const raw = el.pinput.value.trim();
    if (!raw) return;
    el.pinput.value = '';
    state.play.typingPause = false;

    const msg = _sanitizeInput(raw, 5000);
    const playerName = (state.player && state.player.name) || '你';

    // 广播：对所有人说
    addSceneMsg('player', playerName + '：' + msg);
    addEvent('你: ' + msg.slice(0, 50));

    if (state.npcs.length === 0) {
      addSceneMsg('narrator', '四周静悄悄的，没有人在附近。');
      return;
    }

    // 导演 AI 决定谁该回应，避免无关 NPC 插话
    addSceneMsg('narrator', '🎬 导演判定中…');
    const sceneContext = state.play.scene.slice(-10).map(s => `[${s.time || ''}][${s.type}] ${s.content}`).join('\n');
    const { repliers, directed } = await _pickRepliers(playerName, msg, sceneContext);
    state.play.scene = state.play.scene.filter(s => !s.content.includes('导演判定中…'));

    if (directed && repliers.length === 0) {
      addSceneMsg('narrator', '四周一片沉默，无人回应。');
    } else if (directed) {
      addSceneMsg('narrator', '🎬 回应者：' + repliers.map(n => n.name).join('、'));
    }

    for (const npc of repliers) {
      try { await _replyNpc(npc, `「${playerName}」对你说：${msg}`, null); }
      catch(e) { console.warn('[reply]', npc.name, e); addSceneMsg('narrator', '⚠️ ' + npc.name + ' 回复异常：' + (e.message || e)); }
    }

    storageSave();
    } finally { _sendBusy = false; }
  }

  // ===== 世界广播：向整个世界推送事件，由导演挑选 NPC 反应 =====
  async function _broadcastEvent(text) {
    const msg = _sanitizeInput(text.trim(), 2000);
    if (!msg) return;
    addSceneMsg('narrator', '📢 世界事件：' + msg);
    addEvent('📢 世界广播: ' + msg.slice(0, 80));
    const online = state.npcs.filter(n => n.online !== false);
    if (online.length === 0) {
      addSceneMsg('narrator', '世界安静得可怕，没有回应。');
      return;
    }
    // 导演 AI 挑选对事件做出反应的角色
    const sceneContext = state.play.scene.slice(-10).map(s => `[${s.time || ''}][${s.type}] ${s.content}`).join('\n');
    const { repliers } = await _pickRepliers('世界事件', msg, sceneContext);
    if (repliers.length === 0) {
      addSceneMsg('narrator', '世界沉默了一瞬，无人对此做出反应。');
    } else {
      addSceneMsg('narrator', '🎬 反应者：' + repliers.map(n => n.name).join('、'));
    }
    for (const npc of repliers) {
      try { await _replyNpc(npc, '[世界事件] ' + msg + '——你对这件事做出反应。', null); }
      catch(e) { console.warn('[broadcast reply]', npc.name, e); }
    }
    storageSave();
  }

  el.btnWorldBroadcast.addEventListener('click', () => {
    const text = prompt('📢 向整个世界广播事件：\n（NPC 们会听到并做出反应）');
    if (text && text.trim()) _broadcastEvent(text);
  });

  // ===== Auto 模式调度器 =====
  let autoInterval = null;
  function startAutoLoop() {
    if (autoInterval) clearInterval(autoInterval);
    autoInterval = setInterval(() => {
      const p = state.play;
      if (p.mode !== 'auto') return;
      if (document.hidden) return;   // 后台标签页不自动交流，避免多标签互相串台
      if (!p.running || p.typingPause) return;
      if (el.playPanel.classList.contains('panel-hidden')) return;
      if (!state.settings.key || !state.settings.model) return;
      const rate = Math.max(0, parseInt(state.settings.autoRate, 10) || 5);
      if (rate <= 0) return;
      const now = Date.now();
      if (now < p.nextAutoAt) return;
      p.nextAutoAt = now + 60000 / rate;
      _autoInteract();
    }, 1000);
  }
  function stopAutoLoop() {
    if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
  }

  // ===== 时钟系统 =====
  let clockInterval = null;
  function startClock() {
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
      if (document.hidden) return;   // 后台标签页暂停时间流动
      if (!state.play.running || state.play.typingPause) return;
      const speed = Number(state.play.speed) || 0;
      if (speed <= 0) return;
      state.play.clock.minute = (Number(state.play.clock.minute) || 0) + speed;
      if (state.play.clock.minute >= 60) {
        state.play.clock.hour += Math.floor(state.play.clock.minute / 60);
        state.play.clock.minute = Math.floor(state.play.clock.minute % 60);
        while (state.play.clock.hour >= 24) {
          state.play.clock.hour -= 24;
          state.play.clock.day++;
          addEvent(`📅 第${state.play.clock.day}日到来`);
        }
      }
      renderPlayStatus();
    }, 1000);
  }

  // ===== 渲染（创世） =====
  function renderMessages() {
    el.msgList.innerHTML = state.messages.map((m,i) =>
      `<div class="message ${m.type}">${Sanitize.htmlEncode(m.content).replace(/\n/g,'<br>')}
      </div>`
    ).join('');
    el.msgList.scrollTop = el.msgList.scrollHeight;
  }

  function renderWorlds() {
    if (state.worlds.length===0) { el.worldList.innerHTML=''; return; }
    el.worldList.innerHTML = state.worlds.map(w =>
      `<li class="world-item${w.id===state.currentWorld?' active':''}" data-id="${w.id}">
        <span class="world-item-name">${Sanitize.htmlEncode(w.name)}</span>
        <button class="world-del-btn" data-id="${w.id}" title="删除">✕</button>
      </li>`
    ).join('');
    el.worldList.querySelectorAll('.world-del-btn').forEach(b=>b.addEventListener('click',async(e)=>{
      e.stopPropagation(); const id=b.dataset.id; const w=state.worlds.find(x=>x.id===id);
      if(!w||!confirm('删除世界「'+w.name+'」？')) return;
      await vectraStorage.deleteWorld(id);
      const idx=state.worlds.findIndex(x=>x.id===id);
      state.worlds=state.worlds.filter(x=>x.id!==id);
      if(state.currentWorld===id){
        state.currentWorld=state.worlds.length>0?state.worlds[Math.min(idx,state.worlds.length-1)].id:null;
      }
      await vectraStorage.saveWorldList(state.worlds, state.currentWorld);
      // 删除世界后直接刷新页面，避免状态残留导致回退到编辑界面
      location.reload();
    }));
  }

  function renderPhase() {
    el.phaseSteps().forEach(s=>{const p=parseInt(s.dataset.phase);s.classList.remove('active','done');if(p===state.phase)s.classList.add('active');else if(p<state.phase)s.classList.add('done');});
  }

  function renderBible() {
    const b=state.bible;
    el.bibleBody.innerHTML=`
      <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">在下方直接编写世界设定，或通过播种者对话生成。</div>
      <button class="btn-edit-sm" id="btn-edit-bible" style="margin-bottom:10px;">✎ 编辑世界设定</button>
      <div class="editable-section"><div class="editable-header"><h4 style="font-size:12px;color:var(--cyan);letter-spacing:1px;">🌍 世界观</h4></div>
        <div class="editable-view"><p style="font-size:13px;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;">${Sanitize.htmlEncode(b.lore)||'（空）'}</p></div>
      </div>
      <div class="editable-section"><div class="editable-header"><h4 style="font-size:12px;color:var(--cyan);letter-spacing:1px;">⚖️ 法则</h4></div>
        <div class="editable-view">${b.laws.length?`<ul style="list-style:none;">${b.laws.map(l=>`<li style="font-size:13px;color:var(--text-secondary);padding:3px 0 3px 10px;border-left:2px solid var(--border-color);margin-bottom:3px;">${Sanitize.htmlEncode(l)}</li>`).join('')}</ul>`:'<span style="font-size:13px;color:var(--text-muted);">尚无法则</span>'}</div>
      </div>
      <div class="editable-section"><div class="editable-header"><h4 style="font-size:12px;color:var(--cyan);letter-spacing:1px;">📅 纪元</h4></div>
        <div class="editable-view"><p style="font-size:13px;color:var(--text-secondary);">${Sanitize.htmlEncode(b.era)||'未设定'}</p></div>
      </div>
      ${state.launched?'':`<button class="btn-confirm-manual" id="btn-confirm-bible">✓ 手动定稿 · 进入下一阶段</button>`}
    `;
    document.getElementById('btn-edit-bible')?.addEventListener('click', openBibleModal);
    const cb=document.getElementById('btn-confirm-bible');
    if(cb)cb.addEventListener('click',()=>{el.btnConfirm.style.display='none';addMessage('sower','✓ 世界设定已确认。');advancePhase();});
  }

  function renderRoster() {
    if(state.npcs.length===0){el.rosterBody.innerHTML='<div class="empty-state">尚无居民</div><button id="btn-add-npc" class="btn-primary" style="width:100%;margin-top:8px;">+ 创建 NPC</button>';document.getElementById('btn-add-npc')?.addEventListener('click',()=>openNpcModal(null));return;}
    el.rosterBody.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:12px;color:var(--text-muted);">总计 ${state.npcs.length} 位NPC</span><button id="btn-add-npc-top" class="btn-add-sm">+ 创建</button></div>
      ${state.npcs.map((n,i)=>`
        <div class="npc-card"><div class="avatar">${n.icon||'🧑'}</div><div class="info"><div class="name">${n.kind==='plot'?'📖':'⭐'} ${Sanitize.htmlEncode(n.name)} <span style="font-size:10px;color:var(--text-muted);">${n.kind==='plot'?'剧情':'紧要'}</span></div><div class="detail">${Sanitize.htmlEncode([n.age,n.role].filter(Boolean).join(' · '))}</div></div>
          <button class="btn-icon-tiny" data-action="mem-npc" data-idx="${i}" title="记忆">🧠</button>
          <button class="btn-icon-tiny" data-action="edit-npc" data-idx="${i}" title="编辑">✎</button>
          <button class="btn-icon-tiny" data-action="del-npc" data-idx="${i}" title="删除">✕</button>
        </div>`).join('')}
      ${state.launched?'':`<div style="margin-top:12px;display:flex;gap:6px;">
        <button class="btn-confirm-manual" id="btn-confirm-roster" style="flex:1;">✓ 确认居民 · 进入下一阶段</button>
        <button class="btn-secondary-tiny" id="btn-prev-roster">← 上一项</button>
      </div>`}
    `;
    document.getElementById('btn-add-npc-top')?.addEventListener('click',()=>openNpcModal(null));
    el.rosterBody.querySelectorAll('[data-action="edit-npc"]').forEach(b=>b.addEventListener('click',()=>openNpcModal(parseInt(b.dataset.idx))));
    el.rosterBody.querySelectorAll('[data-action="del-npc"]').forEach(b=>b.addEventListener('click',()=>{if(confirm('删除NPC？')){state.npcs.splice(parseInt(b.dataset.idx),1);renderRoster();storageSave();}}));
    el.rosterBody.querySelectorAll('[data-action="mem-npc"]').forEach(b=>b.addEventListener('click',()=>openMemoryModal(parseInt(b.dataset.idx))));
    document.getElementById('btn-confirm-roster')?.addEventListener('click',()=>{el.btnConfirm.style.display='none';addMessage('sower','✓ 居民名册已确认。');advancePhase();});
    document.getElementById('btn-prev-roster')?.addEventListener('click',()=>{advancePhase(-1);switchTab('bible');});
  }

  function renderQuests() {
    const qh = state.quests.length>0?state.quests.map((q,i)=>`
      <div class="quest-node"><div style="display:flex;justify-content:space-between;"><div><span class="node-type">${Sanitize.htmlEncode(q.type||'📖 往事')}</span><div style="font-size:13px;font-weight:500;margin-top:2px;">${Sanitize.htmlEncode(q.name)}</div></div>
        <div style="display:flex;gap:4px;"><button class="btn-icon-tiny" data-action="edit-quest" data-idx="${i}" title="编辑">✎</button><button class="btn-icon-tiny" data-action="del-quest" data-idx="${i}" title="删除">✕</button></div></div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${Sanitize.htmlEncode(q.desc||'')}</div>
      </div>`).join(''):'<div class="empty-state" style="padding:12px;">尚无故事线</div>';
    el.questBody.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:12px;color:var(--text-muted);">${state.quests.length} 条往事</span><button id="btn-add-quest-top" class="btn-add-sm">+ 新建</button></div>${qh}${state.launched?'':`<div style="margin-top:12px;display:flex;gap:6px;"><button class="btn-confirm-manual" id="btn-confirm-quest" style="flex:1;">✓ 确认故事线 · 进入下一阶段</button><button class="btn-secondary-tiny" id="btn-prev-quest">← 上一项</button></div>`}`;
    document.getElementById('btn-confirm-quest')?.addEventListener('click',()=>{el.btnConfirm.style.display='none';addMessage('sower','✓ 往事蓝图已确认。');advancePhase();});
    document.getElementById('btn-prev-quest')?.addEventListener('click',()=>{advancePhase(-1);switchTab('roster');});
    document.getElementById('btn-add-quest-top')?.addEventListener('click',()=>openQuestModal(null));
    el.questBody.querySelectorAll('[data-action="edit-quest"]').forEach(b=>b.addEventListener('click',()=>openQuestModal(parseInt(b.dataset.idx))));
    el.questBody.querySelectorAll('[data-action="del-quest"]').forEach(b=>b.addEventListener('click',()=>{if(confirm('删除往事？')){state.quests.splice(parseInt(b.dataset.idx),1);renderQuests();storageSave();}}));
  }

  function renderLaunch() {
    const ready=state.phase>=4;
    const p=state.player||{name:'',role:'',backstory:''};
    const playerCard=`
      <div class="editable-section" style="margin-bottom:12px;">
        <div class="editable-header"><h4 style="font-size:12px;color:var(--cyan);letter-spacing:1px;">🎮 玩家角色</h4><button class="btn-edit-sm" id="btn-edit-player">✎ 设定</button></div>
        <div class="editable-view"><p style="font-size:13px;color:var(--text-secondary);">${p.name?`你将化身「${Sanitize.htmlEncode(p.name)}」${p.role?'（'+Sanitize.htmlEncode(p.role)+'）':''}进入这个世界。`:'尚未设定玩家角色。'}</p></div>
      </div>`;
    el.launchBody.innerHTML=(ready?`
      <div class="launch-card"><div class="status-badge ready">✓ 世界已就绪</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">序章：${Sanitize.htmlEncode(state.bible.era||'新纪元')}</div>
        <div class="prologue">${Sanitize.htmlEncode(state.bible.lore||'世界等待你的探索…')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">${state.npcs.length} 位居民 · ${state.quests.length} 条往事</div>
        ${playerCard}
        ${state.launched
        ? '<button class="btn-play" id="btn-resume-play">▶ 继续 PLAY</button>'
        : '<button class="btn-play" id="btn-play">▶ 开始 PLAY</button>'}
      </div>`:'<div class="empty-state">世界尚未就绪<br>请完成前三阶段设定</div>'+playerCard)+
      `<div style="margin-top:12px;">${state.launched?'':`<button class="btn-secondary-tiny" id="btn-prev-launch">← 上一项</button>`}</div>`;
    document.getElementById('btn-edit-player')?.addEventListener('click',openPlayerModal);
    document.getElementById('btn-prev-launch')?.addEventListener('click',()=>{advancePhase(-1);switchTab('quest');});
    document.getElementById('btn-play')?.addEventListener('click',()=>{
      state.launched = true;
      switchMode('play');
      storageSave();
    });
    document.getElementById('btn-resume-play')?.addEventListener('click',()=>{
      switchMode('play');
      storageSave();
    });
  }

  function renderRightPanel() { renderBible(); renderRoster(); renderQuests(); renderLaunch(); }
  function renderAll() { renderWorlds(); renderPhase(); renderMessages(); renderRightPanel(); updatePanelVisibility(); }

  function updatePanelVisibility() {
    const hasWorld = state.worlds.length>0 && state.currentWorld;
    const isCreation = state.mode === 'creation';
    el.mainPanel.classList.toggle('panel-hidden', !hasWorld || !isCreation);
    el.rightPanel.classList.toggle('panel-hidden', !hasWorld || !isCreation);
    el.playPanel.classList.toggle('panel-hidden', !hasWorld || isCreation);
    el.storageIndicator.textContent = vectraStorage.label;
    // 小恐龙彩蛋：无世界时显示
    if (!hasWorld && isCreation && window.VectraDino) {
      VectraDino.show();
    } else if (window.VectraDino) {
      VectraDino.hide();
    }
  }

  // 阶段标签仅用于展示，不可点击跳转
  function switchTab(name) {
    el.tabBtns().forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    el.tabContents().forEach(c=>c.classList.toggle('active',c.id==='tab-'+name));
  }
  function initTabs() {
    // 标签可点击切换查看（已启动世界回编辑界面时用于在设定/名册/蓝图/启动间导航）
    el.tabBtns().forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  }

  // ===== 模态框 =====
  let editingNpcIdx=null;
  function openNpcModal(idx) {
    editingNpcIdx=idx;
    document.querySelector('#modal-npc .modal-header h2').textContent=idx!==null?'编辑 NPC':'新建 NPC';
    document.getElementById('btn-npc-save').textContent=idx!==null?'保存修改':'创建 NPC';
    if(idx!==null){const n=state.npcs[idx];el.npcName.value=n.name||'';el.npcKind.value=n.kind==='plot'?'plot':'key';el.npcAge.value=n.age||'';el.npcRole.value=n.role||'';el.npcPersonality.value=n.personality||'';el.npcBackstory.value=n.backstory||';el.npcSpeechStyle.value=n.speechStyle||';el.npcVerbalTic.value=n.verbalTic||';el.npcHabitAction.value=n.habitAction||';}
    else{el.npcName.value='';el.npcKind.value='key';el.npcAge.value='';el.npcRole.value='';el.npcPersonality.value='';el.npcBackstory.value='';el.npcSpeechStyle.value='';el.npcVerbalTic.value='';el.npcHabitAction.value='';}
    el.modalNpc.style.display='flex';setTimeout(()=>el.npcName.focus(),100);
  }
  function closeNpcModal(){el.modalNpc.style.display='none';editingNpcIdx=null;}
  el.btnNpcSave.addEventListener('click',()=>{
    const name=_sanitizeInput(el.npcName.value.trim(),100);if(!name){alert('请输入名称');return;}
    const npc={
      id:'n'+Date.now(),
      name,
      kind:el.npcKind.value==='plot'?'plot':'key',
      age:_sanitizeInput(el.npcAge.value.trim(),50),
      role:_sanitizeInput(el.npcRole.value.trim(),200),
      personality:_sanitizeInput(el.npcPersonality.value.trim(),2000),
      backstory:_sanitizeInput(el.npcBackstory.value.trim(),5000),
      speechStyle:_sanitizeInput(el.npcSpeechStyle.value.trim(),100),
      verbalTic:_sanitizeInput(el.npcVerbalTic.value.trim(),100),
      habitAction:_sanitizeInput(el.npcHabitAction.value.trim(),100),
      icon:['🧙','⚔️','🏹','🔮','🛡️','🧝','⛏️','📜'][state.npcs.length%8]};
    if(editingNpcIdx!==null)Object.assign(state.npcs[editingNpcIdx],npc);else state.npcs.push(npc);
    closeNpcModal();renderRoster();addMessage('sower','🧑‍🌾 NPC「'+npc.name+'」'+(editingNpcIdx!==null?'已更新':'已创建')+'。');storageSave();
  });
  el.btnNpcClose.addEventListener('click',closeNpcModal);

  // ===== 世界设定模态框 =====
  function openBibleModal() {
    el.bibleLore.value = state.bible.lore;
    el.bibleLaws.value = state.bible.laws.join('\n');
    el.bibleEra.value = state.bible.era;
    el.modalBible.style.display='flex';
    setTimeout(()=>el.bibleLore.focus(),100);
  }
  function closeBibleModal(){ el.modalBible.style.display='none'; }
  el.btnBibleSave.addEventListener('click',()=>{
    state.bible.lore=_sanitizeInput(el.bibleLore.value.trim(),50000);
    state.bible.laws=el.bibleLaws.value.split('\n').map(s=>_sanitizeInput(s.trim(),2000)).filter(Boolean);
    state.bible.era=_sanitizeInput(el.bibleEra.value.trim(),2000);
    closeBibleModal();
    renderBible();
    storageSave();
    addMessage('sower','📜 世界设定已更新。');
  });
  el.btnBibleClose.addEventListener('click',closeBibleModal);

  // ===== 玩家角色模态框 =====
  function openPlayerModal() {
    el.playerName.value = state.player.name || '';
    el.playerRole.value = state.player.role || '';
    el.playerBackstory.value = state.player.backstory || '';
    el.modalPlayer.style.display='flex';
    setTimeout(()=>el.playerName.focus(),100);
  }
  function closePlayerModal(){ el.modalPlayer.style.display='none'; }
  el.btnPlayerSave.addEventListener('click',()=>{
    const name=_sanitizeInput(el.playerName.value.trim(),100);
    if(!name){alert('请输入姓名');return;}
    state.player.name=name;
    state.player.role=_sanitizeInput(el.playerRole.value.trim(),200);
    state.player.backstory=_sanitizeInput(el.playerBackstory.value.trim(),5000);
    closePlayerModal();
    renderLaunch();
    storageSave();
    addMessage('sower','🎮 玩家角色「'+name+'」已设定。');
  });
  el.btnPlayerClose.addEventListener('click',closePlayerModal);

  let editingQuestIdx=null;
  function openQuestModal(idx){
    editingQuestIdx=idx;
    document.querySelector('#modal-quest .modal-header h2').textContent=idx!==null?'编辑往事':'新建往事';
    document.getElementById('btn-quest-save').textContent=idx!==null?'保存修改':'添加往事';
    if(idx!==null){const q=state.quests[idx];el.questType.value=q.type||'主线';el.questName.value=q.name||'';el.questDesc.value=q.desc||'';}
    else{el.questType.value='主线';el.questName.value='';el.questDesc.value='';}
    el.modalQuest.style.display='flex';setTimeout(()=>el.questName.focus(),100);
  }
  function closeQuestModal(){el.modalQuest.style.display='none';editingQuestIdx=null;}
  el.btnQuestSave.addEventListener('click',()=>{
    const name=_sanitizeInput(el.questName.value.trim(),200);if(!name){alert('请输入名称');return;}
    const quest={id:'q'+Date.now(),name,type:_sanitizeInput(el.questType.value,50),desc:_sanitizeInput(el.questDesc.value.trim(),5000),time:timestamp()};
    if(editingQuestIdx!==null)Object.assign(state.quests[editingQuestIdx],quest);else state.quests.push(quest);
    closeQuestModal();renderQuests();addMessage('sower','📖 往事「'+quest.name+'」'+(editingQuestIdx!==null?'已更新':'已添加')+'。');storageSave();
  });
  el.btnQuestClose.addEventListener('click',closeQuestModal);

  let memoryNpcIdx=null;let _memEntries=[];
  async function openMemoryModal(idx){
    memoryNpcIdx=idx;const n=state.npcs[idx];
    el.memoryNpcLabel.textContent='— '+n.name;
    el.memoryShort.value=n._shortMem||'';
    el.memoryEntries.innerHTML='<div class="empty-state" style="padding:8px;">加载中…</div>';
    el.memoryTagFilter.value='';
    // 加载结构化记忆
    const res = await vectraStorage.loadNPCMemoryIndex(state.currentWorld,n.id);
    _memEntries = (res && res.entries) || [];
    _renderMemEntries();
    el.modalMemory.style.display='flex';
  }
  function _renderMemEntries(filterTag=''){
    const entries = _memEntries;
    const filtered = filterTag
      ? entries.filter(e => (e.tags||[]).some(t => t.includes(filterTag)))
      : entries;
    if(!filtered.length){el.memoryEntries.innerHTML='<div class="empty-state" style="padding:8px;">'+(!filterTag?'暂无长期记忆。':'无匹配的记忆。')+'</div>';return;}
    el.memoryEntries.innerHTML=filtered.map(e=>`
      <div class="mem-entry" data-id="${e.id||''}" style="margin-bottom:10px;padding:8px;border:1px solid var(--border-color);border-radius:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text-secondary);">${e.time||'第?日'} ⚡${e.importance||5}</span>
          <button class="btn-icon-tiny" data-action="del-mem" data-id="${e.id||''}" title="删除">✕</button>
        </div>
        <div style="font-size:13px;margin:4px 0;">${Sanitize.htmlEncode(e.content||'')}</div>
        <div style="font-size:11px;color:var(--text-muted);">${(e.tags||[]).map(t=>`<span style="background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;margin-right:4px;">${Sanitize.htmlEncode(t)}</span>`).join('')}</div>
      </div>`).join('');
    // tag click-to-filter
    el.memoryEntries.querySelectorAll('[data-action="del-mem"]').forEach(b=>{
      b.addEventListener('click',()=>{_deleteMemEntry(b.dataset.id);});
    });
    el.memoryEntries.querySelectorAll('.mem-entry > div > span[style*="rgba"]').forEach(tagSpan=>{
      // clicking a tag filters
    });
  }
  async function _deleteMemEntry(id){
    const n=state.npcs[memoryNpcIdx];if(!n||!state.currentWorld)return;
    _memEntries = _memEntries.filter(e=>e.id!==id);
    // 重写整个 jsonl + index
    await vectraStorage.overwriteNPCMemory(state.currentWorld,n.id,_memEntries);
    _renderMemEntries(el.memoryTagFilter.value);
    addEvent(n.name+' 的记忆被删除：'+id.slice(0,12));
  }
  el.memoryTagFilter.addEventListener('keydown',(e)=>{
    if(e.key==='Enter'){el.memoryTagFilter.blur();_renderMemEntries(el.memoryTagFilter.value.trim());}
  });
  el.memoryAddBtn.addEventListener('click',async()=>{
    const n=state.npcs[memoryNpcIdx];if(!n||!state.currentWorld)return;
    const tags=el.memoryNewTags.value.split(',').map(s=>s.trim()).filter(Boolean);
    const content=el.memoryNewContent.value.trim();
    const imp=parseInt(el.memoryNewImp.value,10)||5;
    if(!content)return;
    const entry={id:'mem_'+Date.now(),ts:Date.now(),time:formatClock(),type:'reflection',tags:tags,content:_sanitizeInput(content,2000),importance:imp};
    await vectraStorage.appendNPCMemory(state.currentWorld,n.id,[entry]);
    el.memoryNewTags.value='';el.memoryNewContent.value='';el.memoryNewImp.value=5;
    openMemoryModal(memoryNpcIdx); // 刷新
  });
  el.btnMemorySave.addEventListener('click',async()=>{
    if(memoryNpcIdx===null)return;const n=state.npcs[memoryNpcIdx];
    n._shortMem=_sanitizeInput(el.memoryShort.value.trim(),5000);
    el.modalMemory.style.display='none';addMessage('sower','🧠 NPC「'+n.name+'」记忆已保存。');storageSave();
  });
  el.btnMemoryClose.addEventListener('click',()=>{el.modalMemory.style.display='none';});

  // ===== API 设置 =====
  function openSettingsModal(){
    const s=state.settings;el.settingsEndpoint.value=s.endpoint;el.settingsKey.value=s.key;el.settingsModel.value=s.model;
    el.settingsTemp.value=s.temperature;el.settingsTempVal.textContent=s.temperature;el.settingsMaxTokens.value=s.maxTokens;
    el.settingsAutoRate.value=s.autoRate!=null?s.autoRate:5;
    el.settingsDirEndpoint.value=s.directorEndpoint||'';el.settingsDirKey.value=s.directorKey||'';el.settingsDirModel.value=s.directorModel||'';
    el.modalSettings.style.display='flex';
  }
  function closeSettingsModal(){el.modalSettings.style.display='none';}
  el.btnSettings.addEventListener('click',openSettingsModal);
  el.btnSettingsClose.addEventListener('click',closeSettingsModal);
  el.settingsTemp.addEventListener('input',()=>{el.settingsTempVal.textContent=el.settingsTemp.value;});
  el.btnSettingsTest.addEventListener('click',async()=>{
    const ep=el.settingsEndpoint.value.trim().replace(/\/+$/,'');const key=el.settingsKey.value.trim();const model=el.settingsModel.value;
    if(!key){alert('请填写 Key');return;}
    if(!_isSafeUrl(ep)){alert('⚠️ API 端点地址不合法，不允许连接内网地址。');return;}
    el.btnSettingsTest.textContent='测试中…';el.btnSettingsTest.disabled=true;
    try{const res=await fetch(ep+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model,messages:[{role:'user',content:'ping'}],max_tokens:5})});
      if(res.ok)alert('✅ 连接成功！');else{const e=await res.text();alert('❌ 失败 ('+res.status+')');}}
    catch(e){alert('❌ 网络错误，请检查网络连接或 API 端点地址。');}
    el.btnSettingsTest.textContent='测试连接';el.btnSettingsTest.disabled=false;
  });
  el.btnSettingsSave.addEventListener('click',()=>{
    const rawEndpoint=el.settingsEndpoint.value.trim().replace(/\/+$/,'');
    const rawDirEndpoint=el.settingsDirEndpoint.value.trim().replace(/\/+$/,'');
    state.settings={
      endpoint: _sanitizeInput(rawEndpoint, 500),
      key: el.settingsKey.value.trim(),
      model: _sanitizeInput(el.settingsModel.value.trim(), 200),
      temperature: parseFloat(el.settingsTemp.value) || 0.8,
      maxTokens: parseInt(el.settingsMaxTokens.value) || 4096,
      autoRate: Math.max(0, parseInt(el.settingsAutoRate.value, 10) || 5),
      directorEndpoint: _sanitizeInput(rawDirEndpoint, 500),
      directorKey: el.settingsDirKey.value.trim(),
      directorModel: _sanitizeInput(el.settingsDirModel.value.trim(), 200),
    };
    vectraStorage.saveSettings(state.settings);closeSettingsModal();addMessage('sower','⚙ API 设置已保存。');
  });

  el.btnConfirm.addEventListener('click',()=>{el.btnConfirm.style.display='none';addMessage('sower','✓ 已确认。');advancePhase();});
  el.btnStorage.addEventListener('click',()=>{
    addMessage('sower',vectraStorage.mode==='server'?'📁 数据存储在 '+window.location.origin+'/api/status':'💾 使用 localStorage。运行 server.py 启用文件存储。');
  });

  // ===== 游玩输入 =====
  el.psend.addEventListener('click', handlePlaySend);
  el.pinput.addEventListener('keydown', (e) => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); handlePlaySend(); } });
  // 玩家编辑消息时暂停世界（Auto 模式下的时钟与自动交流都会暂停）
  el.pinput.addEventListener('focus', () => { state.play.typingPause = true; });
  el.pinput.addEventListener('blur', () => { state.play.typingPause = false; });

  // ===== 对话模式切换 =====
  el.btnPlayMode.addEventListener('click', () => {
    state.play.mode = state.play.mode === 'auto' ? 'passive' : 'auto';
    renderPlayMode();
    if (state.play.mode === 'auto') {
      state.play.nextAutoAt = 0; // 切换回来时立刻可以自动交流
      addEvent('💬 对话模式：Auto —— NPC会主动交流');
    } else {
      addEvent('👁 对话模式：Passive —— 仅回应玩家');
    }
    storageSave();
  });

  // ===== 倍速控制（1×=64 游戏分钟/秒）=====
  el.spdBtns().forEach(btn => {
    btn.addEventListener('click', () => {
      el.spdBtns().forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const factor = parseFloat(btn.dataset.s);
      state.play.speed = 64 * (Number.isFinite(factor) ? factor : 1);
    });
  });

  // ===== 暂停/继续 =====
  el.pstatus.addEventListener('click', () => {
    state.play.running = !state.play.running;
    renderPlayStatus();
    addEvent(state.play.running ? '▶ 时间继续流动' : '⏸ 时间暂停');
  });

  // ===== 返回创世模式 =====
  el.backBtn.addEventListener('click', () => {
    state.mode = 'creation';
    if (clockInterval) clearInterval(clockInterval);
    stopAutoLoop();
    state.play.typingPause = false;
    updatePanelVisibility();
    renderAll();
    switchTab('bible');
  });

  // ===== 新建世界 =====
  async function handleNewWorld() {
    const name = prompt('输入新世界名称：');
    if (!name || !name.trim()) return;
    const cleanName = _sanitizeInput(name.trim(), 100);
    if (!cleanName) return;
    const world = { id:'w'+Date.now(), name: cleanName };
    state.worlds.push(world); state.currentWorld = world.id;
    state.phase = 1; state.bible = { lore:'', laws:[], era:'' }; state.player = { name:'', role:'', backstory:'' }; state.npcs = []; state.quests = []; state.messages = [];
    state.launched = false;
    state.play.events = []; state.play.clock = { day:1, hour:0, minute:0 };
    state.play.scene = [];
    el.btnConfirm.style.display = 'none'; el.sowerStatus.textContent = '在线 · 聆听中';
    state.mode = 'creation';
    addMessage('sower', '你好！欢迎创造新世界「'+world.name+'」。');
    renderAll(); switchTab('bible'); storageSave();
  }

  // ===== 世界切换 =====
  function initWorldSwitch() {
    el.worldList.addEventListener('click', async (e) => {
      const item = e.target.closest('.world-item');
      if (!item) return;
      const id = item.dataset.id;
      if (id === state.currentWorld) return;
      await storageSave();
      state.currentWorld = id; await storageLoadWorld(id);
      if (state.launched) {
        if (state.messages.length===0) addMessage('sower', '已切换到世界「'+(item.querySelector('.world-item-name')?.textContent||'')+'」。');
        el.btnConfirm.style.display = 'none';
        switchMode('play');
        renderAll();
      } else {
        if (state.messages.length===0) addMessage('sower', '已切换到世界「'+(item.querySelector('.world-item-name')?.textContent||'')+'」。');
        el.btnConfirm.style.display = 'none'; el.sowerStatus.textContent = '在线 · 聆听中';
        state.mode = 'creation'; if (clockInterval) clearInterval(clockInterval);
        renderAll(); switchTab('bible');
      }
    });
  }

  // ===== 多标签页同步 =====
  // 后台标签页暂停世界流动；回到前台或检测到别的标签页删了世界时，重新从存储同步
  async function resyncFromStorage() {
    let wl = null;
    try { wl = await vectraStorage.loadWorldList(); } catch (_) {}
    if (!wl || !Array.isArray(wl.worlds)) return false;
    const remoteIds = wl.worlds.map(w => w.id);
    const localIds = state.worlds.map(w => w.id);
    // 仅当别处删除了本地仍在的世界时才重载（避免覆盖未保存的编辑）
    const deletedElsewhere = localIds.some(id => !remoteIds.includes(id));
    if (!deletedElsewhere) return false;
    state.worlds = wl.worlds;
    if (!state.currentWorld || !state.worlds.some(w => w.id === state.currentWorld)) {
      state.currentWorld = (state.worlds.some(w => w.id === wl.currentWorld) ? wl.currentWorld : (state.worlds[0]?.id)) || null;
    }
    if (state.currentWorld) {
      await storageLoadWorld(state.currentWorld);
    } else {
      state.phase=1; state.bible={lore:'',laws:[],era:''}; state.player={name:'',role:'',backstory:''};
      state.npcs=[]; state.quests=[]; state.messages=[]; state.launched=false;
      state.play.events=[]; state.play.scene=[]; state.play.clock={day:1,hour:0,minute:0};
    }
    return true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (clockInterval) clearInterval(clockInterval);
      stopAutoLoop();
      state.play.typingPause = false;
    } else {
      resyncFromStorage().then(() => {
        if (state.mode === 'play' && state.launched) {
          switchMode('play');   // 恢复时钟与自动交流
        } else {
          updatePanelVisibility();
          renderAll();
        }
      });
    }
  });

  // 其他标签页删除世界后，本标签页同步移除，避免旧数据重新上传
  window.addEventListener('storage', (e) => {
    if (e.key !== 'vectra_data' || document.hidden) return;
    resyncFromStorage().then(changed => {
      if (!changed) return;
      updatePanelVisibility();
      renderAll();
      if (state.mode === 'play' && state.launched) switchMode('play');
    });
  });

  // ===== 初始化 =====
  async function init() {
    await vectraStorage.init();
    const wl = await vectraStorage.loadWorldList();
    if (wl) { state.worlds = wl.worlds || []; state.currentWorld = wl.currentWorld || null; }
    state.settings = vectraStorage.loadSettings();

    if (state.currentWorld) {
      await storageLoadWorld(state.currentWorld);
      if (state.launched) {
        state.mode = 'play';
      }
    }

    renderAll(); initTabs(); initWorldSwitch();

    if (state.launched && state.mode === 'play') {
      el.mainPanel.classList.add('panel-hidden');
      el.rightPanel.classList.add('panel-hidden');
      el.playPanel.classList.remove('panel-hidden');
      renderPlayMode();
      startClock();
      startAutoLoop();
    }
    el.btnSend.addEventListener('click', handleSend);
    el.chatInput.addEventListener('keydown', (e) => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); handleSend(); } });
    el.btnNewWorld.addEventListener('click', handleNewWorld);

    document.querySelectorAll('.modal-overlay').forEach(m => { m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; }); });

    if (state.messages.length===0) addMessage('sower', '欢迎。点击「＋ 新建世界」开始。');
  }

  init();
});