/**
 * 链接直达助手 —— 页面脚本（隔离世界 content script）
 *
 * 职责分工：
 *   - 主文档的链接由本脚本调用 dom-engine.js 扫描（document_idle 时 + 动态监听）
 *   - Shadow DOM（含 B站评论区等 closed 影子根）内的链接由 shadow-patch.js
 *     在主世界扫描改写（见 shadow-patch.js），结果通过 data-ld 属性衔接
 *   - 本脚本负责点击/悬停拦截（data-ld 驱动）、设置管理与统计汇总
 *
 * data-ld 属性值：direct=已改写为真实地址 | resolve=待点击时解析 |
 *                short=短链 | plain=纯文本链接化产物
 */
(() => {
  'use strict';

  const ENGINE = window.LDEngine;
  if (!ENGINE) return; // dom-engine.js 未注入时无法工作

  /* ================= 设置 ================= */

  const DEFAULTS = {
    enabled: true,       // 总开关
    skipRedirect: true,  // 功能A：跳过中转页
    shortLink: true,     // 功能B：短链还原
    linkify: true,       // 功能C：纯文本网址可点击
    hoverResolve: false, // 功能B子项：悬停时预解析真实地址
  };
  let settings = { ...DEFAULTS };

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (s) => {
          void chrome.runtime.lastError;
          resolve({ ...DEFAULTS, ...s });
        });
      } catch (e) {
        resolve({ ...DEFAULTS });
      }
    });
  }

  function sendMsg(msg, cb) {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        void chrome.runtime.lastError; // 扩展重载后旧页面会失联，忽略即可
        if (cb) cb(resp);
      });
    } catch (e) { /* 扩展已重载或不可用 */ }
  }

  // 把设置同步给主世界的 shadow-patch.js（事件 detail 走结构化克隆，可传 JSON）
  function broadcastSettings() {
    try {
      document.dispatchEvent(new CustomEvent('ld-settings', { detail: { ...settings } }));
    } catch (e) { /* 无碍 */ }
  }

  // popup 打开时查询本页的识别统计
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'ldQuery') sendResponse({ stats });
    return false;
  });

  /* ================= 统计 ================= */

  const stats = { rewritten: 0, pending: 0, linkified: 0 };

  function onStat(kind, n) {
    const count = n || 1;
    if (kind === 'direct') stats.rewritten += count;
    else if (kind === 'resolve' || kind === 'short') stats.pending += count;
    else if (kind === 'linkified') stats.linkified += count;
  }

  // 主世界（影子根内）的处理统计回传
  document.addEventListener('ld-shadow-stat', (e) => {
    if (e.detail && e.detail.kind) onStat(e.detail.kind, e.detail.n);
  }, true);

  function engineOpts() {
    return {
      enabled: settings.enabled,
      skipRedirect: settings.skipRedirect,
      shortLink: settings.shortLink,
      linkify: settings.linkify,
      onStat: onStat,
    };
  }

  /* ================= 点击拦截 ================= */

  function findAnchor(e) {
    // 事件可能来自 Shadow DOM 内部：e.target 被「重定向」为影子容器本身，
    // 必须用 composedPath 拿真实点击节点
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!t || !t.closest) return null;
    const a = t.closest('a[href]');
    if (!a) return null;
    const kind = a.getAttribute('data-ld');
    return (kind === 'direct' || kind === 'resolve' || kind === 'short') ? a : null;
  }

  // 主世界（影子根内）转发来的点击：需要后台解析真实地址后打开
  document.addEventListener('ld-open', (e) => {
    if (!settings.enabled) return;
    if (e.detail && e.detail.url) {
      sendMsg({ type: 'openResolved', url: e.detail.url, openIn: e.detail.openIn || 'self' });
    }
  }, true);

  document.addEventListener('click', (e) => {
    if (!settings.enabled) return;
    if (e.defaultPrevented) return;
    // 带修饰键/中键的点击交给浏览器原生处理（新标签、新窗口），不拦截
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = findAnchor(e);
    if (!a) return;
    const kind = a.getAttribute('data-ld');

    if (kind === 'direct') {
      // href 已是真实地址；拦下来强制导航，防止网站 JS 劫持点击再跳中转页
      e.preventDefault();
      if (a.target === '_blank' || a.target === '_new') {
        window.open(a.href, '_blank', 'noopener');
      } else {
        location.href = a.href;
      }
    } else {
      // resolve / short：交给后台解析真实地址后打开
      e.preventDefault();
      const openIn = (a.target === '_blank' || a.target === '_new') ? 'tab' : 'self';
      sendMsg({ type: 'openResolved', url: a.href, openIn });
    }
  }, true);

  document.addEventListener('auxclick', (e) => {
    // 中键：默认在新后台标签打开。direct 型走原生即可，resolve/short 需先解析
    if (!settings.enabled || e.button !== 1 || e.defaultPrevented) return;
    const a = findAnchor(e);
    if (!a) return;
    const kind = a.getAttribute('data-ld');
    if (kind === 'resolve' || kind === 'short') {
      e.preventDefault();
      sendMsg({ type: 'openResolved', url: a.href, openIn: 'tab' });
    }
  }, true);

  /* ================= 悬停预解析（可选） ================= */

  document.addEventListener('mouseover', (e) => {
    if (!settings.enabled || !settings.hoverResolve) return;
    const a = findAnchor(e);
    if (!a) return;
    const kind = a.getAttribute('data-ld');
    if (kind !== 'resolve' && kind !== 'short') return;
    const url = a.href;
    if (resolvedCache.has(url)) {
      a.title = '直达：' + resolvedCache.get(url);
      return;
    }
    if (pendingHover.has(url)) return;
    pendingHover.add(url);
    sendMsg({ type: 'resolve', url }, (resp) => {
      pendingHover.delete(url);
      if (resp && resp.ok && resp.finalUrl) {
        resolvedCache.set(url, resp.finalUrl);
        a.title = '直达：' + resp.finalUrl;
      }
    });
  }, true);

  const resolvedCache = new Map(); // 短链/中转链接 → 真实地址（悬停预解析用）
  const pendingHover = new Set();  // 正在解析中的短链

  /* ================= 主文档动态内容监听 ================= */

  const pendingEls = new Set();
  const pendingTexts = new Set();
  let moTimer = null;

  const mo = new MutationObserver((muts) => {
    if (!settings.enabled) return;
    for (const m of muts) {
      for (const node of m.addedNodes || []) {
        if (node.nodeType === Node.ELEMENT_NODE) pendingEls.add(node);
        else if (node.nodeType === Node.TEXT_NODE) pendingTexts.add(node);
      }
      if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
        pendingTexts.add(m.target);
      }
    }
    if ((pendingEls.size || pendingTexts.size) && !moTimer) {
      moTimer = setTimeout(flushPending, 200);
    }
  });

  function flushPending() {
    moTimer = null;
    const els = [...pendingEls];
    const texts = [...pendingTexts];
    pendingEls.clear();
    pendingTexts.clear();
    if (!settings.enabled) return;

    const opts = engineOpts();
    for (const el of els) {
      if (!el.isConnected) continue;
      ENGINE.scanRoot(el, opts);
      ENGINE.linkifyRoot(el, opts);
    }
    for (const t of texts) {
      if (t.isConnected) {
        const count = ENGINE.linkifyTextNode(t, opts);
        if (count > 0) onStat('linkified', count);
      }
    }
  }

  /* ================= 启动 ================= */

  async function init() {
    settings = await loadSettings();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const wasEnabled = settings.enabled;
      for (const [k, v] of Object.entries(changes)) {
        if (k in DEFAULTS) settings[k] = v.newValue;
      }
      broadcastSettings(); // 设置变化同步给主世界
      // 总开关从关到开：补扫当前页面
      if (settings.enabled && !wasEnabled) {
        ENGINE.scanRoot(document, engineOpts());
        ENGINE.linkifyRoot(document, engineOpts());
      }
    });

    // 1) 主文档链接扫描
    if (settings.enabled) {
      if (settings.skipRedirect || settings.shortLink) ENGINE.scanRoot(document, engineOpts());
      ENGINE.linkifyRoot(document, engineOpts()); // linkify 开关在引擎内部判断
    }

    // 2) 主文档动态内容（SPA、无限滚动等）
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // 3) 设置同步给主世界（shadow-patch 据此扫描影子根）
    broadcastSettings();
  }

  init();
})();
