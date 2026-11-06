// Codeforces Tool — 后台 Service Worker
// 负责读取配置、调用 DeepSeek 接口。在 MV3 中，带 host_permissions 的
// Service Worker 可以直接跨域 fetch，从而绕过内容脚本的 CORS 限制。

const DEFAULTS = {
  apiKey: '',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
  targetLang: '简体中文'
};

// 点击工具栏图标时打开设置页
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    handleTranslate(msg.text, msg.kind || 'problem')
      .then((text) => sendResponse({ text }))
      .catch((err) => sendResponse({ error: err && err.message ? err.message : String(err) }));
    return true; // 保持消息通道，等待异步结果
  }
  return false;
});

async function handleTranslate(text, kind) {
  const cfg = await chrome.storage.local.get(DEFAULTS);

  if (!cfg.apiKey) {
    throw new Error('尚未配置 DeepSeek API Key。请点击浏览器工具栏的插件图标打开设置，填写 Key 后重试。');
  }

  const url = (cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: cfg.model || DEFAULTS.model,
    messages: [
      { role: 'system', content: await getSystemPrompt(cfg.targetLang || DEFAULTS.targetLang, kind) },
      { role: 'user', content: text }
    ],
    temperature: 0.2,
    stream: false
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('网络请求失败：' + (e && e.message ? e.message : e) + '。请检查网络或 API 地址。');
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch (e) {}
    throw new Error(`DeepSeek 接口返回 ${res.status}${res.statusText ? ' ' + res.statusText : ''}${detail ? '：' + detail : ''}`);
  }

  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error('接口返回内容为空或格式异常。');
  }
  return content.trim();
}

// 从 prompt-problem.txt（题面）/ prompt-blog.txt（博客）读取系统提示词
// 其中 {{targetLang}} 为占位符，运行时会替换成目标语言
const promptCache = {}; // 按文件名缓存

const FALLBACK_PROMPT = '你是 Codeforces 内容翻译助手，请把下面的内容翻译成{{targetLang}}，保留所有 [[CF_MATH_n]]、[[CF_CODE_n]] 占位符原样不变，只输出 Markdown 译文。';

async function getSystemPrompt(targetLang, kind) {
  const file = kind === 'blog' ? 'prompt-blog.txt' : 'prompt-problem.txt';
  if (promptCache[file] == null) {
    try {
      const res = await fetch(chrome.runtime.getURL(file));
      promptCache[file] = await res.text();
    } catch (e) {
      promptCache[file] = FALLBACK_PROMPT; // 读取失败时用内置兜底
    }
  }
  return promptCache[file].replace(/\{\{\s*targetLang\s*\}\}/g, targetLang);
}
