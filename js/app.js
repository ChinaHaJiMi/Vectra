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
    npcs: [], quests: [], messages: [],
    settings: { endpoint: 'https://api.openai.com/v1', key: '', model: '', temperature: 0.8, maxTokens: 4096 },
    launched: false,             // 世界是否已启动（锁定编辑 + 自动进入游玩）
    mode: 'creation',            // 'creation' | 'play'
    // 游玩模式状态
    play: {
      clock: { day:1, hour:0, minute:0 },
      speed: 1,
      running: true,
      events: [],                // 世界事件日志
      scene: [],                 // 当前场景对话
      activeNpc: null,           // 当前选中NPC索引
      location: '📍 世界地图',
    },
  };

  // ===== DOM 引用 =====
  const el = {
    // 通用
    worldList: $('#world-list'), btnNewWorld: $('#btn-new-world'),
    btnSettings: $('#btn-settings'), btnStorage: $('#btn-storage'),
    storageIndicator: $('#storage-indicator'),
    // 创世
    phaseSteps: () => $$('.phase-step'), msgList: $('#message-list'),
    chatInput: $('#chat-input'), btnSend: $('#btn-send'), btnConfirm: $('#btn-confirm'),
    bibleBody: $('#bible-body'), rosterBody: $('#roster-body'), questBody: $('#quest-body'), launchBody: $('#launch-body'),
    tabBtns: () => $$('.tab-btn'), tabContents: () => $$('.tab-content'), sowerStatus: $('.sower-status'),
    // 游玩
    playPanel: $('#play-panel'), mainPanel: $('#main-panel'), rightPanel: $('#right-panel'),
    pworldName: $('#pworld-name'), pclock: $('#pclock'), pstatus: $('#pstatus'), plevel: $('#plevel'),
    pnpcList: $('#pnpc-list'), pscene: $('#pscene'), pevents: $('#pevents'),
    pinput: $('#pinput'), psend: $('#psend'), plocation: $('#plocation'), pactiveNpc: $('#pactive-npc'),
    spdBtns: () => $$('.spd'), backBtn: $('#btn-back-creation'),
    // 模态框
    modalSettings: $('#modal-settings'), settingsEndpoint: $('#settings-endpoint'), settingsKey: $('#settings-key'),
    settingsModel: $('#settings-model'), settingsTemp: $('#settings-temp'), settingsTempVal: $('#settings-temp-val'),
    settingsMaxTokens: $('#settings-maxtokens'), btnSettingsTest: $('#btn-settings-test'), btnSettingsSave: $('#btn-settings-save'), btnSettingsClose: $('#btn-settings-close'),
    modalNpc: $('#modal-npc'), npcName: $('#npc-name'), npcAge: $('#npc-age'), npcRole: $('#npc-role'),
    npcPersonality: $('#npc-personality'), npcBackstory: $('#npc-backstory'), btnNpcSave: $('#btn-npc-save'), btnNpcClose: $('#btn-npc-close'),
    modalQuest: $('#modal-quest'), questType: $('#quest-type'), questName: $('#quest-name'), questDesc: $('#quest-desc'),
    btnQuestSave: $('#btn-quest-save'), btnQuestClose: $('#btn-quest-close'),
    modalMemory: $('#modal-memory'), memoryShort: $('#memory-short'), memoryLong: $('#memory-long'),
    memoryNpcLabel: $('#memory-npc-label'), btnMemorySave: $('#btn-memory-save'), btnMemoryClose: $('#btn-memory-close'),
  };

  // ===== 存储封装 =====
  async function storageSave() {
    await vectraStorage.saveWorldList(state.worlds, state.currentWorld);
    await vectraStorage.saveWorldData(state.currentWorld, {
      phase: state.phase, bible: state.bible, npcs: state.npcs, quests: state.quests,
      messages: state.messages.slice(-100),
      playEvents: state.play.events.slice(-200),
      playScene: state.play.scene.slice(-100),
      playClock: state.play.clock,
      launched: state.launched,
    });
    el.storageIndicator.textContent = vectraStorage.label;
  }

  async function storageLoadWorld(id) {
    const d = await vectraStorage.loadWorldData(id);
    if (d) {
      state.phase = d.phase || 1; state.bible = d.bible || { lore:'', laws:[], era:'' };
      state.npcs = d.npcs || []; state.quests = d.quests || []; state.messages = d.messages || [];
      state.launched = d.launched || false;
      state.play.events = d.playEvents || [];
      state.play.clock = d.playClock || { day:1, hour:0, minute:0 };
      state.play.scene = d.playScene || [];
    } else {
      state.phase = 1; state.bible = { lore:'', laws:[], era:'' };
      state.npcs = []; state.quests = []; state.messages = [];
      state.launched = false;
      state.play.events = []; state.play.clock = { day:1, hour:0, minute:0 };
      state.play.scene = [];
    }
  }

  function timestamp() { return new Date().toTimeString().slice(0, 8); }

  // ===== 工具：LLM调用 =====
  async function callLLM(messages, systemExtra) {
    const s = state.settings;
    if (!s.key) return '⚠️ 未配置 API Key。';
    if (!s.model) return '⚠️ 未配置模型 ID。';
    const msgs = [{ role: 'system', content: systemExtra || '' }, ...messages];
    try {
      const res = await fetch((s.endpoint.replace(/\/+$/, '')) + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
        body: JSON.stringify({ model: s.model, messages: msgs, temperature: s.temperature, max_tokens: s.maxTokens }),
      });
      if (!res.ok) { const e = await res.text(); return '❌ API 错误 (' + res.status + '): ' + e.slice(0,200); }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '（没有回复）';
    } catch(e) { return '❌ 网络错误: ' + e.message; }
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
    if (data.bible) { if (data.bible.lore) state.bible.lore = data.bible.lore; if (data.bible.laws) state.bible.laws = data.bible.laws; if (data.bible.era) state.bible.era = data.bible.era; c = true; }
    if (data.npcs) { for (const n of data.npcs) state.npcs.push({ id:'n'+Date.now()+Math.random().toString(36).slice(2,6), name:n.name||'未命名', role:n.role||'', personality:n.personality||'', age:n.age||'', backstory:n.backstory||'', icon:['🧙','⚔️','🏹','🔮','🛡️','🧝','⛏️','📜'][state.npcs.length%8] }); c = true; }
    if (data.quests) { for (const q of data.quests) state.quests.push({ id:'q'+Date.now()+Math.random().toString(36).slice(2,6), name:q.name||'未命名', type:q.type||'主线', desc:q.desc||'', time:timestamp() }); c = true; }
    if (c) { renderRightPanel(); storageSave(); el.btnConfirm.style.display = 'inline-block'; }
  }

  function addMessage(type, content) { state.messages.push({ type, content }); renderMessages(); storageSave(); }

  let isProcessing = false;
  async function handleSend() {
    if (isProcessing) return;
    const text = el.chatInput.value.trim();
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
    } catch(e) { addMessage('sower', '❌ 错误: ' + e.message); }
    isProcessing = false; el.btnSend.disabled = false; el.btnSend.textContent = '发送'; el.chatInput.focus();
  }

  function advancePhase() {
    if (state.phase < 4) { state.phase++; renderAll(); switchTab(['bible','roster','quest','launch'][state.phase-1]); storageSave(); }
  }

  // ===== 切换模式 =====
  function switchMode(mode) {
    state.mode = mode;
    if (mode === 'play') {
      el.mainPanel.classList.add('panel-hidden');
      el.rightPanel.classList.add('panel-hidden');
      el.playPanel.classList.remove('panel-hidden');
      renderPlayMode();
    } else {
      el.playPanel.classList.add('panel-hidden');
      el.mainPanel.classList.remove('panel-hidden');
      el.rightPanel.classList.remove('panel-hidden');
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
    const npcCount = state.npcs.length;
    const questCount = state.quests.length;
    el.plevel.textContent = 'Lv.' + (npcCount + questCount + 1);
  }

  function renderNpcList() {
    el.pnpcList.innerHTML = state.npcs.map((n,i) =>
      `<div class="npc-play-item${state.play.activeNpc===i?' active':''}" data-idx="${i}">
        <span class="dot" style="background:${n.online!==false?'var(--green)':'var(--text-muted)'}"></span>
        <span>${n.name}</span>
      </div>`
    ).join('');
    el.pnpcList.querySelectorAll('.npc-play-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx);
        state.play.activeNpc = idx;
        const n = state.npcs[idx];
        el.pactiveNpc.textContent = '💬 ' + n.name;
        renderNpcList();
        addSceneMsg('narrator', `你走向了 ${n.name}。`);
        addEvent('玩家与 ' + n.name + ' 开始对话');
      });
    });
  }

  function addSceneMsg(type, content) {
    state.play.scene.push({ type, content, time: formatClock() });
    renderScene();
  }

  function renderScene() {
    el.pscene.innerHTML = state.play.scene.length === 0
      ? '<div class="scene-empty">点击居民或事件开始互动</div>'
      : state.play.scene.map(s => `<div class="scene-msg ${s.type}">${s.content}</div>`).join('');
    el.pscene.scrollTop = el.pscene.scrollHeight;
  }

  function addEvent(desc, npcName) {
    const entry = { time: formatClock(), desc, npc: npcName || '', id: Date.now() };
    state.play.events.push(entry);
    renderEvents();
    storageSave();
  }

  function renderEvents() {
    el.pevents.innerHTML = state.play.events.slice(-100).reverse().map(e =>
      `<div class="event-entry" data-id="${e.id}">
        <div class="etime">${e.time}${e.npc?' · '+e.npc:''}</div>
        <div class="edesc">${e.desc}</div>
      </div>`
    ).join('');
    // 点击事件加载到场景
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
    // 添加初始事件
    if (state.play.events.length === 0) {
      addEvent('世界已启动。冒险开始。');
      addSceneMsg('narrator', '世界在你面前展开。选择一位居民开始互动，或输入指令。');
    }
  }

  // ===== NPC AI 对话 =====
  async function handlePlaySend() {
    const text = el.pinput.value.trim();
    if (!text) return;
    el.pinput.value = '';
    addSceneMsg('player', text);
    addEvent('你: ' + text.slice(0, 50));

    if (state.play.activeNpc !== null) {
      const npc = state.npcs[state.play.activeNpc];
      const longMem = await vectraStorage.loadNPCMemory(state.currentWorld, npc.id) || '';
      const shortMem = npc._shortMem || '';

      // === 沉浸式 NPC 提示词 ===
      const systemP = `## 世界背景
${state.bible.lore || '一个普通的现代世界'}
纪元：${state.bible.era || '当代'}

## 你的身份
你是「${npc.name}」，${npc.role || '一个普通人'}。
你的性格：${npc.personality || '和大多数人差不多'}
你的经历：${npc.backstory || '过着平凡的生活'}

## 你记得的事
${shortMem ? '最近发生的事：\n' + shortMem : '今天没什么特别的。'}
${longMem ? '\n你更久远的记忆：\n' + longMem : ''}

## 现在的场景
${state.play.location}，${formatClock()}。

## 扮演规则
- 你就是${npc.name}，完完全全活在这个世界里的人
- 用第一人称「我」说话，口语化、自然，别像念设定
- 对面是来找你搭话的「你」——别把对方当成系统或玩家，就当是一个真实的人站在你面前
- 你对自己的世界是熟悉的，对反常的事会觉得奇怪
- 不知道的事就说不知道，别硬编
- 字数控制在100字以内，一句话说完也行，不用每次都长篇大论
- 不要提及你是AI、NPC或语言模型`;

      const sceneContext = state.play.scene.slice(-10).map(s => `[${s.type}] ${s.content}`).join('\n');

      addSceneMsg('narrator', npc.name + ' 正在思考…');

      const reply = await callLLM([
        { role: 'system', content: '以下是刚才发生的对话：\n' + sceneContext + '\n\n现在回应对方。' },
        { role: 'user', content: text }
      ], systemP);

      state.play.scene = state.play.scene.filter(s => !s.content.includes('正在思考…'));

      const NPC_PREFIX = npc.name + '：';
      const cleanReply = reply.replace(/^(你：|NPC：|)/, '').replace(NPC_PREFIX, '').trim();
      addSceneMsg('npc', npc.name + '：' + cleanReply);
      addEvent(npc.name + ' 回话了', npc.name);

      // 更新短期记忆
      const prevShort = npc._shortMem || '';
      npc._shortMem = (prevShort ? prevShort + '\n' : '') + `[${formatClock()}] 有人跟你说: "${text.slice(0, 30)}"`;
      if (npc._shortMem.length > 500) npc._shortMem = npc._shortMem.slice(-500);
      storageSave();
    } else {
      addSceneMsg('narrator', '你看向四周——选个人说说话吧。点击左侧一位居民。');
    }
  }

  // ===== 时钟系统 =====
  let clockInterval = null;
  function startClock() {
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
      if (!state.play.running) return;
      state.play.clock.minute += state.play.speed;
      if (state.play.clock.minute >= 60) {
        state.play.clock.minute -= 60;
        state.play.clock.hour++;
        if (state.play.clock.hour >= 24) {
          state.play.clock.hour = 0;
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
      `<div class="message ${m.type}">${m.content.replace(/\n/g,'<br>')}
        ${m.type==='sower'?`<button class="msg-edit-btn" data-idx="${i}" title="编辑">✎</button>`:''}
      </div>`
    ).join('');
    el.msgList.scrollTop = el.msgList.scrollHeight;
    el.msgList.querySelectorAll('.msg-edit-btn').forEach(b=>b.addEventListener('click',()=>{
      const idx=parseInt(b.dataset.idx); const nc=prompt('编辑：',state.messages[idx].content);
      if(nc!==null){state.messages[idx].content=nc;renderMessages();storageSave();}
    }));
  }

  function renderWorlds() {
    if (state.worlds.length===0) { el.worldList.innerHTML=''; return; }
    el.worldList.innerHTML = state.worlds.map(w =>
      `<li class="world-item${w.id===state.currentWorld?' active':''}" data-id="${w.id}">
        <span class="world-item-name">${w.name}</span>
        <button class="world-del-btn" data-id="${w.id}" title="删除">✕</button>
      </li>`
    ).join('');
    el.worldList.querySelectorAll('.world-del-btn').forEach(b=>b.addEventListener('click',async(e)=>{
      e.stopPropagation(); const id=b.dataset.id; const w=state.worlds.find(x=>x.id===id);
      if(!w||!confirm('删除世界「'+w.name+'」？')) return;
      await vectraStorage.deleteWorld(id);
      state.worlds=state.worlds.filter(x=>x.id!==id);
      if(state.currentWorld===id){
        state.currentWorld=state.worlds.length>0?state.worlds[0].id:null;
        if(state.currentWorld) await storageLoadWorld(state.currentWorld);
        else {state.phase=1;state.bible={lore:'',laws:[],era:''};state.npcs=[];state.quests=[];state.messages=[];}
      }
      renderAll(); if(state.currentWorld) switchTab('bible');
    }));
  }

  function renderPhase() {
    el.phaseSteps().forEach(s=>{const p=parseInt(s.dataset.phase);s.classList.remove('active','done');if(p===state.phase)s.classList.add('active');else if(p<state.phase)s.classList.add('done');});
  }

  function renderBible() {
    const b=state.bible;
    el.bibleBody.innerHTML=`
      <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted);">在下方直接编写世界设定，或通过播种者对话生成。</div>
      <div class="editable-section"><div class="editable-header"><h4 style="font-size:12px;color:var(--cyan);letter-spacing:1px;">🌍 世界观</h4><button class="btn-edit-sm" data-edit="lore">✎ 编辑</button></div>
        <div class="editable-view" id="view-lore"><p style="font-size:13px;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;">${b.lore||'（空）'}</p></div>
        <div class="editable-edit" id="edit-lore" style="display:none;"><textarea class="inline-editor">${b.lore}</textarea><div class="inline-actions"><button class="btn-primary-tiny" data-save="lore">保存</button><button class="btn-cancel-tiny" data-cancel="lore">取消</button></div></div>
      </div>
      <div class="editable-section"><div class="editable-header"><h4 style="font-size:12px;color:var(--cyan);letter-spacing:1px;">⚖️ 法则</h4><button class="btn-edit-sm" data-edit="laws">✎ 编辑</button></div>
        <div class="editable-view" id="view-laws">${b.laws.length?`<ul style="list-style:none;">${b.laws.map(l=>`<li style="font-size:13px;color:var(--text-secondary);padding:3px 0 3px 10px;border-left:2px solid var(--border-color);margin-bottom:3px;">${l}</li>`).join('')}</ul>`:'<span style="font-size:13px;color:var(--text-muted);">尚无法则</span>'}</div>
        <div class="editable-edit" id="edit-laws" style="display:none;"><textarea class="inline-editor" rows="4" placeholder="每行一条法则">${b.laws.join('\n')}</textarea><div class="inline-actions"><button class="btn-primary-tiny" data-save="laws">保存</button><button class="btn-cancel-tiny" data-cancel="laws">取消</button></div></div>
      </div>
      <div class="editable-section"><div class="editable-header"><h4 style="font-size:12px;color:var(--cyan);letter-spacing:1px;">📅 纪元</h4><button class="btn-edit-sm" data-edit="era">✎ 编辑</button></div>
        <div class="editable-view" id="view-era"><p style="font-size:13px;color:var(--text-secondary);">${b.era||'未设定'}</p></div>
        <div class="editable-edit" id="edit-era" style="display:none;"><textarea class="inline-editor" rows="1">${b.era||''}</textarea><div class="inline-actions"><button class="btn-primary-tiny" data-save="era">保存</button><button class="btn-cancel-tiny" data-cancel="era">取消</button></div></div>
      </div>
      <button class="btn-confirm-manual" id="btn-confirm-bible">✓ 手动定稿 · 进入下一阶段</button>
    `;
    const cb=document.getElementById('btn-confirm-bible');
    if(cb)cb.addEventListener('click',()=>{el.btnConfirm.style.display='none';addMessage('sower','✓ 世界设定已确认。');advancePhase();});
    el.bibleBody.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>{const f=b.dataset.edit;document.getElementById('view-'+f).style.display='none';document.getElementById('edit-'+f).style.display='block';}));
    el.bibleBody.querySelectorAll('[data-save]').forEach(b=>b.addEventListener('click',()=>{const f=b.dataset.save;const ta=document.querySelector('#edit-'+f+' .inline-editor');const v=ta.value;if(f==='lore')state.bible.lore=v;else if(f==='era')state.bible.era=v;else if(f==='laws')state.bible.laws=v.split('\n').filter(s=>s.trim()).map(s=>s.trim());storageSave();renderBible();}));
    el.bibleBody.querySelectorAll('[data-cancel]').forEach(b=>b.addEventListener('click',()=>{const f=b.dataset.cancel;document.getElementById('view-'+f).style.display='block';document.getElementById('edit-'+f).style.display='none';}));
  }

  function renderRoster() {
    if(state.npcs.length===0){el.rosterBody.innerHTML='<div class="empty-state">尚无居民</div><button id="btn-add-npc" class="btn-primary" style="width:100%;margin-top:8px;">+ 创建 NPC</button>';document.getElementById('btn-add-npc')?.addEventListener('click',()=>openNpcModal(null));return;}
    el.rosterBody.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:12px;color:var(--text-muted);">总计 ${state.npcs.length} 位NPC</span><button id="btn-add-npc-top" class="btn-add-sm">+ 创建</button></div>
      ${state.npcs.map((n,i)=>`
        <div class="npc-card"><div class="avatar">${n.icon||'🧑'}</div><div class="info"><div class="name">${n.name}</div><div class="detail">${[n.age,n.role].filter(Boolean).join(' · ')}</div></div>
          <button class="btn-icon-tiny" data-action="mem-npc" data-idx="${i}" title="记忆">🧠</button>
          <button class="btn-icon-tiny" data-action="edit-npc" data-idx="${i}" title="编辑">✎</button>
          <button class="btn-icon-tiny" data-action="del-npc" data-idx="${i}" title="删除">✕</button>
        </div>`).join('')}
    `;
    document.getElementById('btn-add-npc-top')?.addEventListener('click',()=>openNpcModal(null));
    el.rosterBody.querySelectorAll('[data-action="edit-npc"]').forEach(b=>b.addEventListener('click',()=>openNpcModal(parseInt(b.dataset.idx))));
    el.rosterBody.querySelectorAll('[data-action="del-npc"]').forEach(b=>b.addEventListener('click',()=>{if(confirm('删除NPC？')){state.npcs.splice(parseInt(b.dataset.idx),1);renderRoster();storageSave();}}));
    el.rosterBody.querySelectorAll('[data-action="mem-npc"]').forEach(b=>b.addEventListener('click',()=>openMemoryModal(parseInt(b.dataset.idx))));
  }

  function renderQuests() {
    const qh = state.quests.length>0?state.quests.map((q,i)=>`
      <div class="quest-node"><div style="display:flex;justify-content:space-between;"><div><span class="node-type">${q.type||'📖 往事'}</span><div style="font-size:13px;font-weight:500;margin-top:2px;">${q.name}</div></div>
        <div style="display:flex;gap:4px;"><button class="btn-icon-tiny" data-action="edit-quest" data-idx="${i}" title="编辑">✎</button><button class="btn-icon-tiny" data-action="del-quest" data-idx="${i}" title="删除">✕</button></div></div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${q.desc||''}</div>
      </div>`).join(''):'<div class="empty-state" style="padding:12px;">尚无故事线</div>';
    el.questBody.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:12px;color:var(--text-muted);">${state.quests.length} 条往事</span><button id="btn-add-quest-top" class="btn-add-sm">+ 新建</button></div>${qh}<button class="btn-confirm-manual" id="btn-confirm-quest">✓ 确认故事线 · 进入下一阶段</button>`;
    document.getElementById('btn-confirm-quest')?.addEventListener('click',()=>{el.btnConfirm.style.display='none';addMessage('sower','✓ 往事蓝图已确认。');advancePhase();});
    document.getElementById('btn-add-quest-top')?.addEventListener('click',()=>openQuestModal(null));
    el.questBody.querySelectorAll('[data-action="edit-quest"]').forEach(b=>b.addEventListener('click',()=>openQuestModal(parseInt(b.dataset.idx))));
    el.questBody.querySelectorAll('[data-action="del-quest"]').forEach(b=>b.addEventListener('click',()=>{if(confirm('删除往事？')){state.quests.splice(parseInt(b.dataset.idx),1);renderQuests();storageSave();}}));
  }

  function renderLaunch() {
    const ready=state.phase>=4;
    el.launchBody.innerHTML=ready?`
      <div class="launch-card"><div class="status-badge ready">✓ 世界已就绪</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">序章：${state.bible.era||'新纪元'}</div>
        <div class="prologue">${state.bible.lore||'世界等待你的探索…'}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">${state.npcs.length} 位居民 · ${state.quests.length} 条往事</div>
        ${state.launched
        ? '<div class="status-badge ready" style="margin-bottom:12px;">▶ 世界运行中</div>'
        : '<button class="btn-play" id="btn-play">▶ 开始 PLAY</button>'}
      </div>`:'<div class="empty-state">世界尚未就绪<br>请完成前三阶段设定</div>';
    document.getElementById('btn-play')?.addEventListener('click',()=>{
      state.launched = true;
      switchMode('play');
      startClock();
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
  }

  function switchTab(name) {
    el.tabBtns().forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    el.tabContents().forEach(c=>c.classList.toggle('active',c.id==='tab-'+name));
  }
  function initTabs() { el.tabBtns().forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab))); }

  // ===== 模态框 =====
  let editingNpcIdx=null;
  function openNpcModal(idx) {
    editingNpcIdx=idx;
    document.querySelector('#modal-npc .modal-header h2').textContent=idx!==null?'编辑 NPC':'新建 NPC';
    document.getElementById('btn-npc-save').textContent=idx!==null?'保存修改':'创建 NPC';
    if(idx!==null){const n=state.npcs[idx];el.npcName.value=n.name||'';el.npcAge.value=n.age||'';el.npcRole.value=n.role||'';el.npcPersonality.value=n.personality||'';el.npcBackstory.value=n.backstory||'';}
    else{el.npcName.value='';el.npcAge.value='';el.npcRole.value='';el.npcPersonality.value='';el.npcBackstory.value='';}
    el.modalNpc.style.display='flex';setTimeout(()=>el.npcName.focus(),100);
  }
  function closeNpcModal(){el.modalNpc.style.display='none';editingNpcIdx=null;}
  el.btnNpcSave.addEventListener('click',()=>{
    const name=el.npcName.value.trim();if(!name){alert('请输入名称');return;}
    const npc={id:'n'+Date.now(),name,age:el.npcAge.value.trim(),role:el.npcRole.value.trim(),personality:el.npcPersonality.value.trim(),backstory:el.npcBackstory.value.trim(),icon:['🧙','⚔️','🏹','🔮','🛡️','🧝','⛏️','📜'][state.npcs.length%8]};
    if(editingNpcIdx!==null)Object.assign(state.npcs[editingNpcIdx],npc);else state.npcs.push(npc);
    closeNpcModal();renderRoster();addMessage('sower','🧑‍🌾 NPC「'+npc.name+'」'+(editingNpcIdx!==null?'已更新':'已创建')+'。');storageSave();
  });
  el.btnNpcClose.addEventListener('click',closeNpcModal);

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
    const name=el.questName.value.trim();if(!name){alert('请输入名称');return;}
    const quest={id:'q'+Date.now(),name,type:el.questType.value,desc:el.questDesc.value.trim(),time:timestamp()};
    if(editingQuestIdx!==null)Object.assign(state.quests[editingQuestIdx],quest);else state.quests.push(quest);
    closeQuestModal();renderQuests();addMessage('sower','📖 往事「'+quest.name+'」'+(editingQuestIdx!==null?'已更新':'已添加')+'。');storageSave();
  });
  el.btnQuestClose.addEventListener('click',closeQuestModal);

  let memoryNpcIdx=null;
  async function openMemoryModal(idx){
    memoryNpcIdx=idx;const n=state.npcs[idx];
    el.memoryNpcLabel.textContent='— '+n.name;
    const longMem=await vectraStorage.loadNPCMemory(state.currentWorld,n.id);
    el.memoryShort.value=n._shortMem||'';el.memoryLong.value=longMem||'';
    el.modalMemory.style.display='flex';
  }
  el.btnMemorySave.addEventListener('click',async()=>{
    if(memoryNpcIdx===null)return;const n=state.npcs[memoryNpcIdx];
    n._shortMem=el.memoryShort.value.trim();
    const longText=el.memoryLong.value.trim();
    if(longText)await vectraStorage.saveNPCMemory(state.currentWorld,n.id,longText);
    el.modalMemory.style.display='none';addMessage('sower','🧠 NPC「'+n.name+'」记忆已保存。');storageSave();
  });
  el.btnMemoryClose.addEventListener('click',()=>{el.modalMemory.style.display='none';});

  // ===== API 设置 =====
  function openSettingsModal(){
    const s=state.settings;el.settingsEndpoint.value=s.endpoint;el.settingsKey.value=s.key;el.settingsModel.value=s.model;
    el.settingsTemp.value=s.temperature;el.settingsTempVal.textContent=s.temperature;el.settingsMaxTokens.value=s.maxTokens;
    el.modalSettings.style.display='flex';
  }
  function closeSettingsModal(){el.modalSettings.style.display='none';}
  el.btnSettings.addEventListener('click',openSettingsModal);
  el.btnSettingsClose.addEventListener('click',closeSettingsModal);
  el.settingsTemp.addEventListener('input',()=>{el.settingsTempVal.textContent=el.settingsTemp.value;});
  el.btnSettingsTest.addEventListener('click',async()=>{
    const ep=el.settingsEndpoint.value.trim().replace(/\/+$/,'');const key=el.settingsKey.value.trim();const model=el.settingsModel.value;
    if(!key){alert('请填写 Key');return;}
    el.btnSettingsTest.textContent='测试中…';el.btnSettingsTest.disabled=true;
    try{const res=await fetch(ep+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model,messages:[{role:'user',content:'ping'}],max_tokens:5})});
      if(res.ok)alert('✅ 连接成功！');else{const e=await res.text();alert('❌ 失败 ('+res.status+'): '+e.slice(0,200));}}
    catch(e){alert('❌ 网络错误: '+e.message);}
    el.btnSettingsTest.textContent='测试连接';el.btnSettingsTest.disabled=false;
  });
  el.btnSettingsSave.addEventListener('click',()=>{
    state.settings={endpoint:el.settingsEndpoint.value.trim().replace(/\/+$/,''),key:el.settingsKey.value.trim(),model:el.settingsModel.value,temperature:parseFloat(el.settingsTemp.value),maxTokens:parseInt(el.settingsMaxTokens.value)||4096};
    vectraStorage.saveSettings(state.settings);closeSettingsModal();addMessage('sower','⚙ API 设置已保存。');
  });

  el.btnConfirm.addEventListener('click',()=>{el.btnConfirm.style.display='none';addMessage('sower','✓ 已确认。');advancePhase();});
  el.btnStorage.addEventListener('click',()=>{
    addMessage('sower',vectraStorage.mode==='server'?'📁 数据存储在 '+window.location.origin+'/api/status':'💾 使用 localStorage。运行 server.py 启用文件存储。');
  });

  // ===== 游玩输入 =====
  el.psend.addEventListener('click', handlePlaySend);
  el.pinput.addEventListener('keydown', (e) => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); handlePlaySend(); } });

  // ===== 倍速控制 =====
  el.spdBtns().forEach(btn => {
    btn.addEventListener('click', () => {
      el.spdBtns().forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.play.speed = parseFloat(btn.dataset.s);
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
    updatePanelVisibility();
    if (clockInterval) clearInterval(clockInterval);
    // 如果世界已启动，右侧栏显示只读状态
    if (state.launched) {
      el.mainPanel.classList.add('panel-hidden');
      el.rightPanel.classList.add('panel-hidden');
      el.playPanel.classList.remove('panel-hidden');
      renderPlayMode();
    }
  });

  // ===== 新建世界 =====
  async function handleNewWorld() {
    const name = prompt('输入新世界名称：');
    if (!name || !name.trim()) return;
    const world = { id:'w'+Date.now(), name: name.trim() };
    state.worlds.push(world); state.currentWorld = world.id;
    state.phase = 1; state.bible = { lore:'', laws:[], era:'' }; state.npcs = []; state.quests = []; state.messages = [];
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
        // 已启动的世界 → 自动进入游玩模式
        if (state.messages.length===0) addMessage('sower', '已切换到世界「'+(item.querySelector('.world-item-name')?.textContent||'')+'」。');
        el.btnConfirm.style.display = 'none';
        switchMode('play');
        startClock();
        renderAll();
      } else {
        if (state.messages.length===0) addMessage('sower', '已切换到世界「'+(item.querySelector('.world-item-name')?.textContent||'')+'」。');
        el.btnConfirm.style.display = 'none'; el.sowerStatus.textContent = '在线 · 聆听中';
        state.mode = 'creation'; if (clockInterval) clearInterval(clockInterval);
        renderAll(); switchTab('bible');
      }
    });
  }

  // ===== 初始化 =====
  async function init() {
    await vectraStorage.init();
    const wl = await vectraStorage.loadWorldList();
    if (wl) { state.worlds = wl.worlds || []; state.currentWorld = wl.currentWorld || null; }
    state.settings = vectraStorage.loadSettings();
    if (state.currentWorld) {
      await storageLoadWorld(state.currentWorld);
      // 已启动的世界自动进入游玩模式
      if (state.launched) {
        state.mode = 'play';
      }
    }

    renderAll(); initTabs(); initWorldSwitch();
    // 自动进入游玩模式（延时确保 DOM 渲染完成）
    if (state.launched && state.mode === 'play') {
      el.mainPanel.classList.add('panel-hidden');
      el.rightPanel.classList.add('panel-hidden');
      el.playPanel.classList.remove('panel-hidden');
      renderPlayMode();
      startClock();
    }
    // 如果世界已启动，禁用播种者对话
  if (state.launched) {
    el.chatInput.disabled = true;
    el.btnSend.disabled = true;
    el.sowerStatus.textContent = '🔒 世界运行中 · 创世已锁定';
  }
  el.btnSend.addEventListener('click', handleSend);
    el.chatInput.addEventListener('keydown', (e) => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); handleSend(); } });
    el.btnNewWorld.addEventListener('click', handleNewWorld);

    document.querySelectorAll('.modal-overlay').forEach(m => { m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; }); });

    if (state.messages.length===0) addMessage('sower', '欢迎。点击「＋ 新建世界」开始。');
  }

  init();
});