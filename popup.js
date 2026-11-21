/**
 * 链接直达助手 —— 设置面板
 */
(() => {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    skipRedirect: true,
    shortLink: true,
    linkify: true,
    hoverResolve: false,
  };

  const SUB_KEYS = ['skipRedirect', 'shortLink', 'linkify', 'hoverResolve'];

  document.addEventListener('DOMContentLoaded', async () => {
    const settings = await chrome.storage.sync.get(DEFAULTS);

    const toggles = {};
    for (const key of Object.keys(DEFAULTS)) {
      const el = document.getElementById(key);
      if (!el) continue;
      el.checked = settings[key];
      el.addEventListener('change', () => {
        chrome.storage.sync.set({ [key]: el.checked });
      });
      toggles[key] = el;
    }

    // 总开关关闭时，子功能置灰
    function refreshDisabled() {
      for (const key of SUB_KEYS) {
        toggles[key].disabled = !toggles.enabled.checked;
      }
    }
    refreshDisabled();
    toggles.enabled.addEventListener('change', refreshDisabled);

    // 查询当前页统计
    const statsEl = document.getElementById('stats');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        statsEl.textContent = '本页无法注入插件（浏览器内部页面）。';
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'ldQuery' }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.stats) {
          statsEl.textContent = '本页尚未生效，刷新页面后重试。';
          return;
        }
        const { rewritten, pending, linkified } = resp.stats;
        const total = rewritten + pending + linkified;
        if (total === 0) {
          statsEl.textContent = '本页没有识别到可直达的链接。';
        } else {
          statsEl.textContent =
            `本页识别 ${total} 条：改写 ${rewritten} · 待点击解析 ${pending} · 链接化 ${linkified}`;
        }
      });
    } catch (e) {
      statsEl.textContent = '本页无法注入插件（浏览器内部页面）。';
    }
  });
})();
