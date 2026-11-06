const DEFAULTS = {
  apiKey: '',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
  targetLang: '简体中文'
};

const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  $('apiKey').value = cfg.apiKey || '';
  $('model').value = cfg.model;
  $('baseUrl').value = cfg.baseUrl;
  $('targetLang').value = cfg.targetLang;
}

async function save() {
  const cfg = {
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    baseUrl: $('baseUrl').value.trim().replace(/\/+$/, ''),
    targetLang: $('targetLang').value
  };
  await chrome.storage.local.set(cfg);
  const s = $('status');
  s.textContent = '已保存 ✓';
  setTimeout(() => { s.textContent = ''; }, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('save').addEventListener('click', save);
});
