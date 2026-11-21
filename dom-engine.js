/**
 * 链接直达助手 —— DOM 处理引擎
 *
 * 纯 DOM 逻辑（规则匹配、链接改写、纯文本链接化），不含任何扩展 API，
 * 因此可以同时注入到主世界（处理 Shadow DOM 内的链接）和隔离世界
 * （处理主文档的链接）。规则表来自 rules.js。
 */
(() => {
  const RULES = window.LinkDirectRules || { redirectRules: [], shortLinkHosts: [] };
  const processed = new WeakSet();

  /* ================= 规则匹配 ================= */

  function hostMatches(hostname, hostRule) {
    return hostname === hostRule || hostname.endsWith('.' + hostRule);
  }

  function matchRedirectRule(url) {
    for (const rule of RULES.redirectRules) {
      if (!hostMatches(url.hostname, rule.host)) continue;
      if (rule.path && !url.pathname.startsWith(rule.path)) continue;
      return rule;
    }
    return null;
  }

  function isShortLink(url) {
    return RULES.shortLinkHosts.some((h) => hostMatches(url.hostname, h));
  }

  /**
   * 从中转链接里提取真实地址。
   * rawQuery 模式：目标地址直接是整个 query（如 pixiv jump.php?<编码URL>，无参数名）；
   * 常规模式：目标地址在参数里（URLSearchParams 会先解码一层）。
   * 个别站点存的是双重编码，最多再解一层；结果必须是 http/https 开头才算数。
   */
  function extractTarget(url, rule) {
    let raw;
    if (rule.rawQuery) {
      raw = url.search.slice(1); // 去掉开头的 ?，整个 query 就是目标
      if (!raw) return null;
    } else {
      raw = url.searchParams.get(rule.param);
      if (!raw) return null;
    }
    let s = raw.trim();
    if (!/^https?:\/\//i.test(s)) {
      try { s = decodeURIComponent(s); } catch (e) { return null; }
      if (!/^https?:\/\//i.test(s)) return null;
    }
    try {
      const u = new URL(s);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (e) { /* 非法地址 */ }
    return null;
  }

  /* ================= 链接处理 ================= */

  /**
   * 处理单个链接：识别命中规则则改写 href 或打 data-ld 标记。
   * opts: { enabled, skipRedirect, shortLink, onStat }
   * 返回 'direct' | 'resolve' | 'short' | null
   * 标记写入 data-ld 属性——该属性跨世界可见，点击拦截据此工作。
   */
  function processAnchor(a, opts) {
    if (processed.has(a)) return null;
    if (!opts || !opts.enabled) return null;
    let url;
    try { url = new URL(a.href); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    let kind = null;
    if (opts.skipRedirect !== false) {
      const rule = matchRedirectRule(url);
      if (rule && (rule.param || rule.rawQuery)) {
        const target = extractTarget(url, rule);
        if (target && target !== a.href) {
          a.setAttribute('href', target);
          a.setAttribute('data-ld', 'direct');
          kind = 'direct';
        }
      }
      if (!kind && rule && rule.resolve) {
        // 真实地址在服务端（如百度搜索结果），点击时再解析
        a.setAttribute('data-ld', 'resolve');
        kind = 'resolve';
      }
    }
    if (!kind && opts.shortLink !== false && isShortLink(url)) {
      a.setAttribute('data-ld', 'short');
      kind = 'short';
    }
    if (kind) {
      processed.add(a);
      if (opts.onStat) opts.onStat(kind);
    }
    return kind;
  }

  /** 扫描一个根节点（document / 元素 / ShadowRoot 均可）下的所有链接 */
  function scanRoot(root, opts) {
    if (!root || !root.querySelectorAll) return;
    let list;
    try { list = root.querySelectorAll('a[href]'); } catch (e) { return; }
    for (const a of list) processAnchor(a, opts);
    if (root.matches && root.matches('a[href]')) processAnchor(root, opts);
  }

  /* ================= 纯文本网址可点击 ================= */

  const URL_RE = /(https?:\/\/|www\.)[A-Za-z0-9\-._~%/?#&=;+@:!*'$]+/gi;
  const SKIP_TEXT = 'a, script, style, noscript, textarea, input, select, option, pre, code, samp, kbd, [contenteditable]';

  function trimUrl(s) {
    return s.replace(/[.,;:!?'"<>*]+$/, '');
  }

  function isValidMatch(s) {
    if (/^https?:\/\//i.test(s)) return true;
    // www. 开头的必须有合法域名（至少两段）且顶级域是字母
    const m = /^www\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/.exec(s);
    if (!m) return false;
    const tld = s.split(/[/?#]/)[0].split('.').pop();
    return /^[A-Za-z]{2,24}$/.test(tld);
  }

  function normalizeUrl(s) {
    return /^https?:\/\//i.test(s) ? s : 'https://' + s;
  }

  function linkifyTextNode(node, opts) {
    if (!opts || !opts.enabled || opts.linkify === false) return 0;
    if (!node || !node.nodeValue) return 0;
    const text = node.nodeValue;
    if (text.length < 8 || text.length > 10000) return 0;
    if (!/(https?:\/\/|www\.)/i.test(text)) return 0;
    const p = node.parentElement;
    if (!p || p.closest(SKIP_TEXT)) return 0;
    if (node.ownerDocument !== document) return 0;

    URL_RE.lastIndex = 0;
    const matches = [];
    let m;
    while ((m = URL_RE.exec(text)) !== null) {
      const trimmed = trimUrl(m[0]);
      if (!trimmed || !isValidMatch(trimmed)) continue;
      matches.push({ start: m.index, end: m.index + trimmed.length, url: normalizeUrl(trimmed), label: trimmed });
      URL_RE.lastIndex = m.index + trimmed.length;
      if (matches.length >= 50) break; // 单节点上限，防极端长文本卡顿
    }
    if (matches.length === 0) return 0;

    // 从后往前切割，避免前面的切割使索引失效；
    // 每轮切割后 node 始终指向「前段」文本节点（可能还藏着更靠前的匹配）
    const anchor = document.createElement('a');
    let made = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
      const { start, end, url, label } = matches[i];
      if (end > node.length) continue;
      node.splitText(end);               // 尾部拆出去，node 保持在前段 [0..end)
      const mid = node.splitText(start); // mid 是 [start..end) 这一段
      const a = anchor.cloneNode(false);
      a.href = url;
      a.setAttribute('data-ld', 'plain');
      a.textContent = label;
      mid.replaceWith(a);
      made++;
      // a 的前一个兄弟节点就是保留下来的前段，继续在里面找更早的匹配
      node = a.previousSibling || node;
      if (!node || node === a) break;
    }
    return made;
  }

  /**
   * 对一个根节点做纯文本链接化。
   * 支持 document、元素、ShadowRoot（影子根属于文档片段）。
   */
  function linkifyRoot(root, opts) {
    if (!opts || !opts.enabled || opts.linkify === false) return;
    const kind = root && root.nodeType;
    const ok = kind === Node.DOCUMENT_NODE || kind === Node.ELEMENT_NODE || kind === Node.DOCUMENT_FRAGMENT_NODE;
    if (!ok) return;
    let walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || node.nodeValue.length < 8) return NodeFilter.FILTER_REJECT;
          if (!/(https?:\/\/|www\.)/i.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p || p.closest(SKIP_TEXT)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
    } catch (e) { return; }

    // 先收集再修改：TreeWalker 遍历中改 DOM 会跳节点
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    let count = 0;
    for (const node of nodes) count += linkifyTextNode(node, opts);
    if (count > 0 && opts.onStat) opts.onStat('linkified', count);
  }

  window.LDEngine = {
    processAnchor: processAnchor,
    scanRoot: scanRoot,
    linkifyRoot: linkifyRoot,
    linkifyTextNode: linkifyTextNode,
    hostMatches: hostMatches,
    matchRedirectRule: matchRedirectRule,
    extractTarget: extractTarget,
    isShortLink: isShortLink,
  };
})();
