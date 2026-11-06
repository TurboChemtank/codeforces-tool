// Codeforces Tool — 内容脚本
// 题面、Input 说明、Output 说明、Note 四部分各自提供独立的「翻译」按钮；
// 博客（题解）页则为每个折叠块（.spoiler / <details>）提供独立的「翻译」按钮。
// 译文插入在对应部分的正下方，互不影响。
// 关键点：
// 1. Codeforces 的公式分隔符是 $$$...$$$（行内）与 $$$$...$$$$（块级），
//    需在 MathJax 渲染前（DOMContentLoaded）抓取原始 HTML，把公式替换为占位符再翻译；
// 2. 发送前剔除隐藏/不可见的干扰文本（透明文字、display:none、零宽字符、移出可视区域等），
//    防止针对 AI 的注入提示词进入翻译；
// 3. DeepSeek 返回 Markdown，用 marked 编译成 HTML，公式占位符由 KaTeX 渲染成公式；
// 4. 翻译结果缓存到 chrome.storage.local（按题目 URL 区分），再次打开时直接恢复。
(() => {
  'use strict';

  // ---------- 工具 ----------
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function childByClass(root, cls) {
    for (const el of root.children) if (el.classList.contains(cls)) return el;
    return null;
  }

  // Codeforces 公式分隔符：$$$$...$$$$（块级）优先于 $$$...$$$（行内）
  const MATH_RE = /(\$\$\$\$[\s\S]+?\$\$\$\$|\$\$\$[^$\n]+?\$\$\$)/g;

  // ---------- 防御：剔除隐藏/不可见的干扰文本 ----------
  // 零宽字符、方向控制符、软连字符等不可见字符
  const INVISIBLE_CHARS = /[\u00AD\u180E\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2061\u2062\u2063\u2064\u2800\u3164\uFEFF\uFFA0]/g;

  function stripInvisibleChars(s) {
    return String(s).replace(INVISIBLE_CHARS, '');
  }

  function parseColor(str) {
    if (!str) return null;
    const m = String(str).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (!m) return null;
    return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), a: m[4] != null ? parseFloat(m[4]) : 1 };
  }

  // 向上找到第一个非透明背景色，默认白底
  function effectiveBackground(el) {
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      let cs;
      try { cs = getComputedStyle(node); } catch (e) { break; }
      const bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function isHidden(el) {
    if (el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.hasAttribute('hidden')) return true;

    let cs;
    try { cs = getComputedStyle(el); } catch (e) { return false; }

    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    if (parseFloat(cs.fontSize) === 0) return true;

    // 移出可视区域（经典隐藏手法：left/top/right/bottom 或 text-indent 设为超大负值）
    if (cs.position === 'absolute' || cs.position === 'fixed') {
      if (parseFloat(cs.left) <= -9999 || parseFloat(cs.top) <= -9999 ||
          parseFloat(cs.right) <= -9999 || parseFloat(cs.bottom) <= -9999) return true;
    }
    if (parseFloat(cs.textIndent) <= -9999) return true;

    // 文字颜色透明，或与背景色一致（如白字白底）
    const fg = parseColor(cs.color);
    if (fg) {
      if (fg.a === 0) return true;
      const bg = effectiveBackground(el);
      if (bg && fg.r === bg.r && fg.g === bg.g && fg.b === bg.b) return true;
    }
    return false;
  }

  // MathJax 渲染后的公式容器（span.MathJax / mjx-container / MathJax_Preview 等）：
  // 这些是公式的「可视化输出 + 预览」，真正的源在 <script type="math/tex"> 里。
  function isMathJaxVisual(el) {
    if (el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.tagName.toLowerCase() === 'script') return false;
    const cls = el.getAttribute('class') || '';
    return /MathJax|mjx-|MJX_/.test(cls) || el.getAttribute('role') === 'math';
  }

  // ---------- 序列化（HTML -> 带占位符的 Markdown 文本） ----------
  function tokenizeText(text, mathTokens) {
    let out = '';
    let last = 0;
    let m;
    MATH_RE.lastIndex = 0;
    while ((m = MATH_RE.exec(text)) !== null) {
      out += text.slice(last, m.index);
      const raw = m[0];
      const display = raw.startsWith('$$$$');
      const id = mathTokens.length;
      mathTokens.push({ id, tex: display ? raw.slice(4, -4) : raw.slice(3, -3), display });
      out += `[[CF_MATH_${id}]]`;
      last = m.index + raw.length;
    }
    out += text.slice(last);
    return out;
  }

  function serializeNode(node, mathTokens, codeTokens, force) {
    if (node.nodeType === Node.TEXT_NODE) {
      return tokenizeText(stripInvisibleChars(node.nodeValue), mathTokens);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    // script/style 单独处理（script 默认 display:none，但不能因此丢掉公式源码）
    if (tag === 'script') {
      const t = node.getAttribute('type') || '';
      if (t.indexOf('math/tex') !== -1) {
        const id = mathTokens.length;
        mathTokens.push({ id, tex: stripInvisibleChars(node.textContent), display: t.indexOf('display') !== -1 });
        return `[[CF_MATH_${id}]]`;
      }
      return '';
    }
    if (tag === 'style') return '';

    // MathJax 已渲染的公式：只保留 <script type="math/tex"> 源，跳过可视化输出与预览，
    // 否则同一个公式会被重复序列化多次（脚本源 + 预览 + 渲染结果各算一份）。
    if (isMathJaxVisual(node)) {
      let out = '';
      for (const s of node.querySelectorAll('script[type*="math/tex"]')) {
        const st = s.getAttribute('type') || '';
        const id = mathTokens.length;
        mathTokens.push({ id, tex: stripInvisibleChars(s.textContent), display: st.indexOf('display') !== -1 });
        out += `[[CF_MATH_${id}]]`;
      }
      return out;
    }

    // 隐藏元素及其子树整体跳过（force=true 时强制纳入，用于折叠块这类默认隐藏但属于正常内容的情况）
    if (!force && isHidden(node)) return '';

    // 代码块：用围栏代码块包裹占位符，交给 marked 渲染为 <pre><code>
    if (tag === 'pre') {
      const id = codeTokens.length;
      codeTokens.push({ id, code: stripInvisibleChars(node.textContent) });
      return `\n\n\`\`\`\n[[CF_CODE_${id}]]\n\`\`\`\n\n`;
    }
    if (tag === 'br') return '\n';

    if (node.classList && node.classList.contains('section-title')) {
      return `\n## ${stripInvisibleChars(node.textContent).trim()}\n`;
    }

    let inner = '';
    for (const c of Array.from(node.childNodes)) inner += serializeNode(c, mathTokens, codeTokens, force);
    if (/^(P|DIV|SECTION|CENTER|UL|OL|LI|TABLE|TR|H[1-6]|BLOCKQUOTE|ARTICLE|HEADER)$/i.test(tag)) {
      return `\n${inner}\n`;
    }
    return inner;
  }

  function collapse(text) {
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 对「活 DOM 元素」直接序列化（这样能用 getComputedStyle 判断可见性）
  function extractFromElements(elements, force) {
    const mathTokens = [];
    const codeTokens = [];
    let md = '';
    for (const el of elements) md += serializeNode(el, mathTokens, codeTokens, force);
    return { markdown: collapse(md), mathTokens, codeTokens };
  }

  // ---------- 渲染 ----------
  function renderMathHtml(tex, display) {
    try {
      return katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: false });
    } catch (e) {
      return `<code class="cft-math-err">${escapeHtml(tex)}</code>`;
    }
  }

  function renderMarkdown(md, mathTokens, codeTokens) {
    // 把 DeepSeek 返回的占位符换成哨兵字符（容忍其插入空格），避免被 Markdown 解析干扰
    md = md.replace(/\[\[\s*(CF_(?:MATH|CODE)_(\d+))\s*\]\]/g, (m, key, num) => {
      const n = parseInt(num, 10);
      if (key.indexOf('CF_MATH') === 0) return mathTokens[n] ? `\u0001M${n}\u0001` : m;
      return codeTokens[n] ? `\u0002C${n}\u0002` : m;
    });

    // Markdown -> HTML（marked 会做 HTML 转义，安全）
    let html = marked.parse(md);

    // 把 marked 生成的 h1~h6 换成自定义 div，避免被 Codeforces 页面的标题样式干扰
    html = html.replace(/<h[1-6][^>]*>/g, '<div class="cft-h">').replace(/<\/h[1-6]>/g, '</div>');

    // 还原代码块（在 <pre><code> 内替换占位符为原始代码内容）
    for (const t of codeTokens) {
      html = html.split(`\u0002C${t.id}\u0002`).join(escapeHtml(t.code));
    }
    // 还原公式（KaTeX 渲染成 HTML）
    for (const t of mathTokens) {
      html = html.split(`\u0001M${t.id}\u0001`).join(renderMathHtml(t.tex, t.display));
    }
    // 清理任何残留哨兵
    html = html.replace(/[\u0001\u0002][MC]\d+[\u0001\u0002]/g, '');
    return html;
  }

  function requestTranslation(text, kind) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'translate', text, kind }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.error) return reject(new Error(resp.error));
          resolve(resp && resp.text);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // ---------- 缓存 ----------
  const CACHE_STORE = 'cfToolCache';
  const CACHE_MAX = 100;

  function loadCache() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(CACHE_STORE, (r) => resolve(r[CACHE_STORE] || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  function saveCache(cache) {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      keys.sort((a, b) => ((cache[a]._ts || 0) - (cache[b]._ts || 0)));
      for (let i = 0; i < keys.length - CACHE_MAX; i++) delete cache[keys[i]];
    }
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [CACHE_STORE]: cache }, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  async function cacheSet(cacheKey, sectionId, entry) {
    const all = await loadCache();
    const prob = all[cacheKey] || {};
    prob[sectionId] = entry;
    prob._ts = Date.now();
    all[cacheKey] = prob;
    await saveCache(all);
  }

  // ---------- 分区 ----------
  const SECTION_CLASSES = ['input-specification', 'output-specification', 'sample-tests', 'note'];

  // 题面正文：.header 之后、第一个章节（Input/Output/Examples/Note）之前的所有兄弟元素
  function findMainEls(root) {
    const els = [];
    let started = false;
    for (const el of root.children) {
      const c = el.classList;
      if (!started) {
        if (c.contains('header')) started = true;
      } else {
        if (SECTION_CLASSES.some((cls) => c.contains(cls))) break;
        els.push(el);
      }
    }
    return els;
  }

  function buildSections(root) {
    const header = childByClass(root, 'header');
    const mainEls = findMainEls(root);
    const inputEl = childByClass(root, 'input-specification');
    const outputEl = childByClass(root, 'output-specification');
    const noteEl = childByClass(root, 'note');

    const secs = {};
    if (mainEls.length) {
      const e = extractFromElements(mainEls);
      secs.main = {
        id: 'main',
        title: '题面',
        markdown: e.markdown,
        mathTokens: e.mathTokens,
        codeTokens: e.codeTokens,
        anchor: mainEls[mainEls.length - 1],
        buttonHost: header || root
      };
    }
    const defs = [
      ['input', '输入说明', inputEl],
      ['output', '输出说明', outputEl],
      ['note', '样例解释', noteEl]
    ];
    for (const [id, title, el] of defs) {
      if (el) {
        const e = extractFromElements([el]);
        secs[id] = {
          id,
          title,
          markdown: e.markdown,
          mathTokens: e.mathTokens,
          codeTokens: e.codeTokens,
          anchor: el,
          buttonHost: el
        };
      }
    }
    return secs;
  }

  // ---------- UI ----------
  function buildBoxHTML(sec, html) {
    return '<div class="cft-head">译文 · ' + sec.title +
      ' <span class="cft-badge">DeepSeek</span>' +
      '<button type="button" class="cft-retranslate">重新翻译</button></div>' +
      '<div class="cft-body">' + html + '</div>';
  }

  function wireRetranslate(box, sec, btn, boxes, boxData) {
    const rb = box.querySelector('.cft-retranslate');
    if (rb) rb.addEventListener('click', () => doTranslate(sec, btn, boxes, boxData));
  }

  async function doTranslate(sec, btn, boxes, boxData) {
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '翻译中…';
    try {
      // 惰性获取内容：博客折叠块在点击时才序列化（其内容可能是懒加载的，
      // 启动时只有「加载中」占位符）
      let markdown, mathTokens, codeTokens;
      if (typeof sec.extract === 'function') {
        const e = await sec.extract();
        markdown = e.markdown; mathTokens = e.mathTokens; codeTokens = e.codeTokens;
      } else {
        markdown = sec.markdown; mathTokens = sec.mathTokens; codeTokens = sec.codeTokens;
      }
      if (!markdown) throw new Error('该部分没有可翻译的内容。');
      if (looksLoading(markdown)) throw new Error('该部分内容仍在加载中，请先点开折叠块，稍后再点「翻译」。');
      const translated = await requestTranslation(markdown, sec.kind);
      const html = renderMarkdown(translated, mathTokens, codeTokens);

      let box = boxes[sec.id];
      if (!box) {
        box = document.createElement('div');
        box.className = 'cft-box';
        sec.anchor.insertAdjacentElement('afterend', box);
        boxes[sec.id] = box;
      }
      box.innerHTML = buildBoxHTML(sec, html);
      box.style.display = '';
      btn.textContent = '收起';

      boxData[sec.id] = { markdown: translated, mathTokens, codeTokens };
      wireRetranslate(box, sec, btn, boxes, boxData);
      await cacheSet(currentCacheKey(), sec.id, { ...boxData[sec.id], open: true });
    } catch (e) {
      btn.textContent = prev || '翻译';
      window.alert('翻译失败：' + (e && e.message ? e.message : e) +
        '\n\n若未配置 API Key，请点击浏览器工具栏的插件图标打开设置。');
    } finally {
      btn.disabled = false;
    }
  }

  function onToggle(sec, btn, boxes, boxData) {
    const box = boxes[sec.id];
    if (!box) {
      doTranslate(sec, btn, boxes, boxData);
      return;
    }
    const hidden = box.style.display === 'none';
    box.style.display = hidden ? '' : 'none';
    btn.textContent = hidden ? '收起' : '翻译';
    if (boxData[sec.id]) {
      cacheSet(currentCacheKey(), sec.id, { ...boxData[sec.id], open: !hidden });
    }
  }

  function restoreBox(sec, btn, boxes, boxData, entry) {
    const html = renderMarkdown(entry.markdown, entry.mathTokens, entry.codeTokens);
    const box = document.createElement('div');
    box.className = 'cft-box';
    box.innerHTML = buildBoxHTML(sec, html);
    sec.anchor.insertAdjacentElement('afterend', box);
    boxes[sec.id] = box;
    boxData[sec.id] = { markdown: entry.markdown, mathTokens: entry.mathTokens, codeTokens: entry.codeTokens };
    box.style.display = entry.open ? '' : 'none';
    btn.textContent = entry.open ? '收起' : '翻译';
    wireRetranslate(box, sec, btn, boxes, boxData);
  }

  // 页面上的翻译目标（题面各部分 / 博客全文），统一用于缓存恢复
  let PAGE_STATES = [];

  function setupProblemStatement(root) {
    const secs = buildSections(root);
    const boxes = {};
    const boxData = {};
    const btns = {};
    for (const sec of Object.values(secs)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cft-btn';
      btn.textContent = '翻译';
      btn.title = '翻译' + sec.title;
      btn.addEventListener('click', () => onToggle(sec, btn, boxes, boxData));
      sec.buttonHost.insertBefore(btn, sec.buttonHost.firstChild);
      btns[sec.id] = btn;
    }
    PAGE_STATES.push({ secs, boxes, boxData, btns });
  }

  function currentCacheKey() {
    return location.pathname + location.search;
  }

  async function restoreCached() {
    try {
      const cache = await loadCache();
      const key = currentCacheKey();
      const problemCache = cache[key] || {};
      for (const st of PAGE_STATES) {
        for (const sec of Object.values(st.secs)) {
          const entry = problemCache[sec.id];
          if (entry && entry.markdown) {
            restoreBox(sec, st.btns[sec.id], st.boxes, st.boxData, entry);
          }
        }
      }
    } catch (e) {}
  }

  // ---------- 博客 ----------
  function isBlogEntryPage() {
    return /^\/blog\/entry\/\d+/.test(location.pathname);
  }

  // 博客正文：第一个不在评论区里的 .ttypography
  function findBlogBodyEl() {
    const direct = document.querySelector('.blog-content > .ttypography');
    if (direct && !direct.closest('.comments')) return direct;
    for (const el of document.querySelectorAll('.ttypography')) {
      if (el.closest('.comments') || el.closest('.comment')) continue;
      return el;
    }
    return null;
  }

  // 折叠块标题（用于按钮提示与译文框标题）
  function blockTitle(el) {
    const t = el.querySelector('.spoiler-title, summary');
    if (t) {
      const txt = stripInvisibleChars(t.textContent).trim().replace(/\s+/g, ' ');
      if (txt) return txt.slice(0, 40);
    }
    return '折叠块';
  }

  // 收集博客正文里的「折叠块」：CF 的 .spoiler 与原生 <details>。
  // 只取顶层块（不把嵌套在另一个折叠块里的内容重复算作一个翻译单元）。
  function collectBlogBlocks(body) {
    const blocks = [];
    for (const el of body.querySelectorAll('.spoiler')) {
      if (el.parentElement && el.parentElement.closest('.spoiler')) continue; // 嵌套 spoiler 跳过
      blocks.push({ el, title: blockTitle(el) });
    }
    for (const el of body.querySelectorAll('details')) {
      if (el.parentElement && (el.parentElement.closest('details') || el.parentElement.closest('.spoiler'))) continue;
      blocks.push({ el, title: blockTitle(el) });
    }
    blocks.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    return blocks;
  }

  // 折叠块的正文来源：CF spoiler 取 .spoiler-content；<details> 取除 <summary> 外的子节点
  function blockSources(blk) {
    const sc = blk.el.querySelector('.spoiler-content');
    if (sc) return [sc];
    return Array.from(blk.el.children).filter((c) => c.tagName.toLowerCase() !== 'summary');
  }

  const LOADING_RE = /(tutorial\s+is\s+loading|loading|正在加载|加载中?|\.\.\.)/i;

  // 判断折叠块内容是否仍是「加载中」占位符（真实题解较长，占位符很短）
  function looksLoading(md) {
    if (!md) return true;
    const s = stripInvisibleChars(md).replace(/\s+/g, ' ').trim();
    return s.length < 120 && LOADING_RE.test(s);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function prependTitle(blk, md) {
    return (blk.title && blk.title !== '折叠块' ? '## ' + blk.title + '\n\n' : '') + md;
  }

  // 点击翻译时才实时抓取折叠块内容：若内容仍是「加载中」占位符，
  // 则尝试点开折叠块触发 CF 的懒加载，并轮询等待真实内容就绪。
  async function extractBlockContent(blk) {
    const extract = () => extractFromElements(blockSources(blk), true);
    let e = extract();
    if (!looksLoading(e.markdown)) {
      return { markdown: prependTitle(blk, e.markdown), mathTokens: e.mathTokens, codeTokens: e.codeTokens };
    }

    const title = blk.el.querySelector('.spoiler-title');
    if (title) { try { title.click(); } catch (_) {} }

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await sleep(200);
      e = extract();
      if (e.markdown && !looksLoading(e.markdown)) {
        return { markdown: prependTitle(blk, e.markdown), mathTokens: e.mathTokens, codeTokens: e.codeTokens };
      }
    }
    return { markdown: prependTitle(blk, e.markdown), mathTokens: e.mathTokens, codeTokens: e.codeTokens };
  }

  function setupBlog() {
    if (!isBlogEntryPage()) return;
    const body = findBlogBodyEl();
    if (!body) return;

    const blocks = collectBlogBlocks(body);
    if (!blocks.length) {
      setupBlogFullText(body); // 没有折叠块时退回「全文翻译」
      return;
    }

    const boxes = {};
    const boxData = {};
    const btns = {};
    const secs = {};

    blocks.forEach((blk, i) => {
      const sec = {
        id: 'blog-' + i,
        title: blk.title,
        kind: 'blog',
        anchor: blk.el,
        // 惰性提取：点击时才序列化，避免在启动时拿到懒加载的「加载中」占位符
        extract: () => extractBlockContent(blk)
      };
      secs[sec.id] = sec;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cft-btn';
      btn.textContent = '翻译';
      btn.title = '翻译：' + sec.title;
      btn.addEventListener('click', () => onToggle(sec, btn, boxes, boxData));
      blk.el.insertAdjacentElement('beforebegin', btn);
      btns[sec.id] = btn;
    });

    if (Object.keys(secs).length) {
      PAGE_STATES.push({ secs, boxes, boxData, btns });
    }
  }

  // 博客没有折叠块时的兜底：整篇翻译（原行为）
  function setupBlogFullText(body) {
    const e = extractFromElements([body]);
    const sec = {
      id: 'blog',
      title: '全文',
      kind: 'blog',
      markdown: e.markdown,
      mathTokens: e.mathTokens,
      codeTokens: e.codeTokens,
      anchor: body
    };
    const boxes = {};
    const boxData = {};
    const btns = {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cft-btn';
    btn.textContent = '翻译全文';
    btn.title = '翻译整篇博客';
    btn.addEventListener('click', () => onToggle(sec, btn, boxes, boxData));
    body.parentElement.insertBefore(btn, body);
    btns[sec.id] = btn;
    PAGE_STATES.push({ secs: { [sec.id]: sec }, boxes, boxData, btns });
  }

  function boot() {
    // 同步：先在 MathJax 渲染前序列化原始内容（含隐藏文本过滤），并添加按钮
    document.querySelectorAll('.problem-statement').forEach(setupProblemStatement);
    setupBlog();
    // 异步：恢复缓存
    restoreCached();
  }

  // ---------- 启动 ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
