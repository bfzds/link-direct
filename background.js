/**
 * 链接直达助手 —— 后台 Service Worker
 *
 * 职责：
 *   1. 解析「服务端 302 型」中转链接与短链接的真实地址（跟随重定向请求）
 *   2. 解析完成后按点击意图打开（当前标签页 / 新后台标签页）
 *
 * 为什么在后台做：短链的真实地址只能通过发一次网络请求得知，
 * 页面脚本受同源策略限制无法跨域请求，后台凭借 host_permissions 可以。
 */

const MAX_HOPS = 2; // 最多跟随两跳重定向（个别短链套短链）

/**
 * 跟随重定向请求，返回最终落在的真实地址；
 * 无法解析时返回 null（调用方需退回原地址）。
 */
async function resolveFinalUrl(url) {
  let current = url;
  for (let i = 0; i < MAX_HOPS; i++) {
    let resp;
    try {
      resp = await fetch(current, { redirect: 'follow', credentials: 'omit' });
    } catch (e) {
      return null;
    }
    // 不消费响应体，主动释放连接
    try { if (resp.body) await resp.body.cancel(); } catch (e) { /* 无碍 */ }
    if (resp.url && resp.url !== current) {
      current = resp.url; // 可能还是短链（套娃），下一轮再跟一次
    } else {
      break;
    }
  }
  return current;
}

async function openResolved(msg, sender) {
  const final = await resolveFinalUrl(msg.url);
  const url = final || msg.url; // 解析失败退回原地址，保证链接至少能点开
  try {
    if (msg.openIn === 'tab') {
      await chrome.tabs.create({ url, active: false });
    } else if (sender.tab) {
      await chrome.tabs.update(sender.tab.id, { url });
    } else {
      await chrome.tabs.update({ url });
    }
  } catch (e) {
    // 来源标签可能已被关闭，兜底新开一个标签
    try { await chrome.tabs.create({ url }); } catch (e2) { /* 放弃 */ }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'resolve') {
    // 悬停预解析：只返回解析结果，不导航
    resolveFinalUrl(msg.url)
      .then((final) => sendResponse({ ok: !!final, finalUrl: final }))
      .catch(() => sendResponse({ ok: false }));
    return true; // 异步响应
  }

  if (msg.type === 'openResolved') {
    openResolved(msg, sender);
    return false; // 不需要回复
  }
});
