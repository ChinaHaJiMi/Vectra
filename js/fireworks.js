// ============================================================
// VECTRA — 礼花特效彩蛋
// 小恐龙场景下（无世界时），输入 VECTRA（不分大小写）触发全屏礼花
// ============================================================

(function () {
  'use strict';

  const DINO_PANEL = document.getElementById('dino-game');
  const SECRET = 'vectra';
  const PALETTE = [
    '#00d4ff', '#4facfe', '#a78bfa', '#f472b6',
    '#fbbf24', '#34d399', '#f87171', '#ffffff',
  ];
  const TEXT_FONT = '700 52px "Courier New", monospace';

  let canvas = null;
  let ctx = null;
  let rafId = null;
  let rockets = [];
  let particles = [];
  let keyBuffer = '';
  let endTime = 0;
  let textStart = 0;

  function random(min, max) { return min + Math.random() * (max - min); }
  function pickColor() { return PALETTE[Math.floor(Math.random() * PALETTE.length)]; }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'vectra-fireworks';
    canvas.style.cssText =
      'position:fixed;left:0;top:0;width:100%;height:100%;' +
      'z-index:9999;pointer-events:none;display:none;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function launchRocket() {
    rockets.push({
      x: random(window.innerWidth * 0.12, window.innerWidth * 0.88),
      y: window.innerHeight + 8,
      vx: random(-0.5, 0.5),
      vy: random(-11, -8),
      color: pickColor(),
      trail: [],
    });
  }

  function explode(rocket) {
    const count = 60 + Math.floor(Math.random() * 40);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + random(-0.15, 0.15);
      const speed = random(1.5, 6);
      particles.push({
        x: rocket.x,
        y: rocket.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: Math.random() < 0.3 ? '#ffffff' : rocket.color,
        life: 1,
        size: random(1.2, 2.8),
      });
    }
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = 'lighter';

    if (now < endTime - 1500 && Math.random() < 0.03) launchRocket();

    // 火箭上升 + 拖尾
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.trail.push({ x: r.x, y: r.y, life: 1 });
      r.vy += 0.055;
      r.x += r.vx;
      r.y += r.vy;

      for (let t = r.trail.length - 1; t >= 0; t--) {
        r.trail[t].life -= 0.06;
        if (r.trail[t].life <= 0) r.trail.splice(t, 1);
      }
      for (const p of r.trail) {
        ctx.globalAlpha = Math.max(0, p.life * 0.7);
        ctx.fillStyle = r.color;
        ctx.fillRect(p.x, p.y, 2.5, 2.5);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.fillRect(r.x - 1.5, r.y - 1.5, 3, 3);

      if (r.vy >= -1.5 || r.y < window.innerHeight * 0.12) {
        explode(r);
        rockets.splice(i, 1);
      }
    }

    // 爆炸粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.03;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.008;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 祝贺文字：VECTRA
    if (now - textStart < 2200) {
      const t = (now - textStart) / 2200;
      ctx.globalAlpha = Math.max(0, Math.sin(Math.PI * t));
      ctx.fillStyle = '#ffffff';
      ctx.font = TEXT_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur = 28;
      ctx.fillText('VECTRA', window.innerWidth / 2, window.innerHeight / 2);
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (now >= endTime && rockets.length === 0 && particles.length === 0) {
      cancelAnimationFrame(rafId);
      rafId = null;
      canvas.style.display = 'none';
    }
  }

  const VectraFireworks = {
    show() {
      ensureCanvas();
      rockets = [];
      particles = [];
      canvas.style.display = 'block';
      endTime = performance.now() + 6500;
      textStart = performance.now();
      launchRocket();
      launchRocket();
      launchRocket();
      if (!rafId) rafId = requestAnimationFrame(loop);
    },
    hide() {
      rockets = [];
      particles = [];
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (canvas) canvas.style.display = 'none';
    },
  };
  window.VectraFireworks = VectraFireworks;

  // 口令检测：仅在小恐龙面板可见时生效，且忽略输入框
  document.addEventListener('keydown', (e) => {
    if (!DINO_PANEL || DINO_PANEL.classList.contains('panel-hidden')) return;
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (e.key.length !== 1) return;
    const ch = e.key.toLowerCase();
    if (!/[a-z0-9]/.test(ch)) return;
    keyBuffer = (keyBuffer + ch).slice(-SECRET.length);
    if (keyBuffer === SECRET) {
      keyBuffer = '';
      VectraFireworks.show();
    }
  });
})();
