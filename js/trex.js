// ============================================================
// VECTRA · Chrome 浏览器自带恐龙游戏（T-Rex Runner）接入层
// 保持与 app.js 原有 VectraDino.show()/hide() 相同的接口
// ============================================================

(function () {
  const container = document.getElementById('dino-game');
  if (!container) return;

  let runner = null;

  function ensureRunner() {
    if (runner) return runner;
    if (!window.Runner) return null;
    runner = new Runner('.interstitial-wrapper');
    return runner;
  }

  window.VectraDino = {
    show() {
      container.classList.remove('panel-hidden');
      // 等浏览器完成 reflow 后再创建 Runner，保证能读到容器尺寸
      requestAnimationFrame(() => {
        const r = ensureRunner();
        if (!r) return;
        if (r.canvas && r.canvas.width < 10) {
          // 曾在隐藏状态下初始化，画布尺寸为 0，重新计算
          r.adjustDimensions();
        } else if (r.paused && r.playCount > 0 && !r.crashed) {
          r.play();
        }
      });
    },
    hide() {
      container.classList.add('panel-hidden');
      if (runner) runner.stop();
    },
  };
})();
