// ============================================================
// VECTRA — 输入净化工具模块
// 统一处理所有用户输入的过滤、净化、验证
// ============================================================

const Sanitize = (() => {
  'use strict';

  // 控制字符正则（保留 \n \t \r）
  const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

  // XSS 危险标签/属性模式
  const XSS_PATTERNS = /<script[\s\S]*?>[\s\S]*?<\/script>|javascript\s*:|on\w+\s*=|data\s*:/gi;

  /**
   * 净化单行文本
   * @param {*} text - 输入
   * @param {number} maxLen - 最大长度，默认 2000
   * @returns {string}
   */
  function text(text, maxLen = 2000) {
    if (typeof text !== 'string') {
      if (text === null || text === undefined) return '';
      text = String(text);
    }
    return text
      .replace(CONTROL_CHARS, '')     // 移除控制字符
      .replace(XSS_PATTERNS, '')      // 移除 XSS 注入
      .slice(0, maxLen);              // 截断长度
  }

  /**
   * 净化多行文本（保留格式）
   * @param {*} text
   * @param {number} maxLen - 最大长度，默认 10000
   * @returns {string}
   */
  function paragraph(text, maxLen = 10000) {
    return text(text, maxLen);
  }

  /**
   * 净化 JSON 数据（递归）
   * @param {*} data
   * @param {number} maxDepth
   * @returns {*}
   */
  function json(data, maxDepth = 10) {
    if (maxDepth <= 0) return null;
    if (typeof data === 'string') {
      return text(data, 10000);
    } else if (Array.isArray(data)) {
      return data.map(item => json(item, maxDepth - 1));
    } else if (data !== null && typeof data === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = json(value, maxDepth - 1);
      }
      return result;
    }
    return data; // number, boolean, null 保持原样
  }

  /**
   * 验证并净化 URL（防止 SSRF）
   * @param {string} urlString
   * @returns {string|null} 合法则返回净化后的 URL，不合法返回 null
   */
  function url(urlString) {
    if (typeof urlString !== 'string') return null;
    urlString = urlString.trim();
    if (!urlString) return null;

    try {
      const url = new URL(urlString);
      const hostname = url.hostname.toLowerCase();

      // 只允许 http/https
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

      // 内网/保留地址黑名单
      const blocked = [
        'localhost', '127.', '0.0.0.0', '10.', '172.16.', '172.17.', '172.18.',
        '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
        '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.',
        '172.31.', '192.168.', '[::1]', '[::]', '169.254.',
      ];
      for (const p of blocked) {
        if (hostname.startsWith(p)) return null;
      }

      // IPv4 私有地址检测
      const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (ipMatch) {
        const first = parseInt(ipMatch[1]);
        if ([0, 10, 127, 169, 172, 192].includes(first)) return null;
      }

      return urlString;
    } catch (_) {
      return null;
    }
  }

  /**
   * 净化世界/NPC ID（字母数字短横线）
   * @param {string} id
   * @returns {string|null}
   */
  function id(id) {
    if (typeof id !== 'string') return null;
    const clean = id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!clean || clean.length > 64) return null;
    return clean;
  }

  /**
   * 安全编码 HTML（防止 XSS 输出）
   * @param {string} unsafe
   * @returns {string}
   */
  function htmlEncode(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#039;');
  }

  return {
    text,
    paragraph,
    json,
    url,
    id,
    htmlEncode,
  };
})();

// 如使用 ES Module 可以 export，但 VECTRA 目前使用全局模式
// export default Sanitize;