/**
 * 链接直达助手 —— Shadow DOM 捕获与扫描（主世界，document_start 注入）
 *
 * 背景：B站新版评论区等站点用「关闭模式」的 Shadow Root（一种对外不可见的
 * 影子容器）渲染内容，隔离世界的扩展脚本无法访问其中的链接。
 *
 * 本脚本以主世界（world: MAIN）在页面任何脚本之前注入，配合 dom-engine.js
 * 直接在主世界完成影子根内链接的识别与改写；改写结果通过 data-ld 属性
 * （跨世界可见）与隔离世界的点击拦截配合。
 */
(() => {
  if (!Element || !Element.prototype || typeof Element.prototype.attachShadow !== 'function') return;
  const engine = window.LDEngine;
  if (!engine) return;

  // 设置镜像：隔离世界通过 ld-settings 事件（可克隆 JSON）同步，默认全开
  const settings = { enabled: true, skipRedirect: true, shortLink: true, linkify: true, hoverResolve: false };

  document.addEventListener('ld-settings', (e) => {
    if (e.detail && typeof e.detail === 'object') {
      for (const k of ['enabled', 'skipRedirect', 'shortLink', 'linkify', 'hoverResolve']) {
        if (k in e.detail) settings[k] = e.detail[k];
      }
    }
  }, true);

  // 影子根内的处理统计回传给隔离世界（汇总进 popup 显示）
  function reportStat(kind, n) {
    try {
      document.dispatchEvent(new CustomEvent('ld-shadow-stat', { detail: { kind: kind, n: n || 1 } }));
    } catch (e) { /* 统计失败无碍 */ }
  }

  function optsFor() {
    return {
      enabled: settings.enabled,
      skipRedirect: settings.skipRedirect,
      shortLink: settings.shortLink,
      linkify: settings.linkify,
      onStat: reportStat,
    };
  }

  function scanOnce(root) {
    const opts = optsFor();
    if (settings.skipRedirect || settings.shortLink) engine.scanRoot(root, opts);
    if (settings.linkify) engine.linkifyRoot(root, opts);
  }

  const observed = new WeakSet();

  function setupRoot(root) {
    if (!root || observed.has(root)) return;
    observed.add(root);
    scanOnce(root);
    // 影子根内后续动态插入的内容（评论分页加载等）
    try {
      const mo = new MutationObserver(() => {
        if (!settings.enabled) return;
        clearTimeout(root.__ldRescan);
        root.__ldRescan = setTimeout(() => scanOnce(root), 200);
      });
      mo.observe(root, { childList: true, subtree: true, characterData: true });
    } catch (e) { /* 影子根可能已断开 */ }
  }

  const native = Element.prototype.attachShadow;
  const seen = new WeakSet();
  Element.prototype.attachShadow = function (init) {
    const root = native.call(this, init);
    try {
      if (root && this.nodeType === 1 && !seen.has(root)) {
        seen.add(root);
        setupRoot(root);
      }
    } catch (e) { /* 记录失败不影响页面 */ }
    return root;
  };

  /* ================= 影子根内的点击拦截 =================
   * 隔离世界对 closed 影子根的 composedPath 不可见（浏览器隐私机制），
   * 点击拦截必须在主世界完成：本脚本是影子根的创建者，路径完整。
   * 主文档的点击仍由隔离世界处理，这里跳过。 */

  function shadowAnchorFromEvent(e) {
    const path = e.composedPath ? e.composedPath() : [];
    const t = path[0] || e.target;
    if (!t || !t.closest) return null;
    try {
      if (t.getRootNode && t.getRootNode() === document) return null; // 主文档，归隔离世界管
    } catch (err) { /* 无碍 */ }
    const a = t.closest('a[href]');
    if (!a) return null;
    const kind = a.getAttribute('data-ld');
    return (kind === 'direct' || kind === 'resolve' || kind === 'short') ? a : null;
  }

  document.addEventListener('click', (e) => {
    if (!settings.enabled || e.defaultPrevented) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = shadowAnchorFromEvent(e);
    if (!a) return;
    const kind = a.getAttribute('data-ld');
    if (kind === 'direct') {
      // href 已是真实地址；拦下来强制导航，防止站点 JS 劫持点击弹确认层
      e.preventDefault();
      if (a.target === '_blank' || a.target === '_new') window.open(a.href, '_blank', 'noopener');
      else location.href = a.href;
    } else {
      // resolve / short：需要后台解析，转发给隔离世界走扩展消息链路
      e.preventDefault();
      const openIn = (a.target === '_blank' || a.target === '_new') ? 'tab' : 'self';
      document.dispatchEvent(new CustomEvent('ld-open', { detail: { url: a.href, openIn: openIn } }));
    }
  }, true);

  document.addEventListener('auxclick', (e) => {
    // 中键：resolve/short 需先解析再新标签打开；direct 型走浏览器原生（href 已真实）
    if (!settings.enabled || e.button !== 1 || e.defaultPrevented) return;
    const a = shadowAnchorFromEvent(e);
    if (!a) return;
    const kind = a.getAttribute('data-ld');
    if (kind === 'resolve' || kind === 'short') {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('ld-open', { detail: { url: a.href, openIn: 'tab' } }));
    }
  }, true);
})();
