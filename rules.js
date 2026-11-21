/**
 * 链接直达助手 —— 站点规则表
 *
 * 这是对外扩展的核心：想支持新站点，只需要往下面的表里加一条规则，
 * 不用动任何其他代码。改完保存后，到浏览器的扩展管理页点「刷新」即可生效。
 *
 * ============================================================
 * 一、redirectRules：中转链接规则
 * ============================================================
 * 每条规则描述一种「被网站包装过的跳转链接」。
 * 字段说明：
 *
 *   host    必填。要匹配的域名，自动兼容子域名：
 *           写 'baidu.com' 可以同时命中 www.baidu.com、m.baidu.com 等所有子域。
 *
 *   path    可选。路径前缀，只有当链接的路径以此开头时才命中。
 *           写 '/link' 可同时命中 /link 和 /link2/xxx。
 *
 *   param   与 resolve 二选一。
 *           真实地址藏在哪个 URL 参数里。例如知乎把目标放在 ?target= 参数中。
 *           插件会自动做 URL 解码（最多两层），并校验结果必须是 http/https 开头。
 *
 *   resolve 与 param 二选一。
 *           真实地址不在参数里（服务端跳转型，比如百度搜索结果
 *           www.baidu.com/link?url=xxxx，参数是一串密文）。
 *           插件会在点击时向该链接发一次请求，跟踪它的真实去向再直达。
 *           注意：这种方式每次点击会多一次网络请求，只对确实需要的站点使用。
 *
 * 命中规则后，插件会做两件事：
 *   1. 把页面内该链接的 href 改写成真实地址（悬停时状态栏可见）；
 *   2. 如果你直接打开了中转页本身（比如手动点到了知乎的确认页），
 *      页面加载后会自动跳转到真实地址。
 *
 * 示例（往数组里加即可）：
 *   { host: 'link.example.com', param: 'target' }
 *   { host: 'example.cn',       path: '/go',    param: 'url' }
 *   { host: 'search.example.com', path: '/r',   resolve: true }
 */
window.LinkDirectRules = {
  redirectRules: [
    // 知乎：link.zhihu.com/?target=<真实地址>
    { host: 'link.zhihu.com', param: 'target' },
    // CSDN：link.csdn.net/?target=<真实地址>
    { host: 'link.csdn.net', param: 'target' },
    // 掘金：link.juejin.cn/?target=<真实地址>
    { host: 'link.juejin.cn', param: 'target' },
    // 简书：links.jianshu.com/go?to=<真实地址>
    { host: 'links.jianshu.com', param: 'to' },
    // 豆瓣：www.douban.com/link2/?url=<真实地址>
    { host: 'douban.com', path: '/link2/', param: 'url' },
    // 开源中国：www.oschina.net/action/GoToLink?goto=<真实地址>
    { host: 'oschina.net', path: '/action/GoToLink', param: 'goto' },
    // 百度搜索结果：www.baidu.com/link?url=<密文>，服务端 302 跳转，点击时请求解析
    { host: 'baidu.com', path: '/link', resolve: true },
    // 豆瓣新版跳转服务：link.douban.com/?q=<密文>，参数加密，点击时请求解析
    { host: 'link.douban.com', resolve: true },
    // B站跳转服务：link.bilibili.com/?i=<密文>，点击时请求解析
    { host: 'link.bilibili.com', resolve: true },
  ],

  /* ============================================================
   * 二、shortLinkHosts：短链接域名列表
   * ============================================================
   * 短链接的真实地址只能通过网络请求得知。插件在点击时向短链
   * 发一次请求、跟踪其真实去向，然后一步直达目标。
   * 往数组里加域名即可支持新的短链服务。
   */
  shortLinkHosts: [
    't.cn',     // 微博短链
    'url.cn',   // 腾讯短链
    'dwz.cn',   // 百度短网
    'bit.ly',   // Bitly
  ],
};
