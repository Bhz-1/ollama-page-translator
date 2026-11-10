// options.js — 设置页读写 chrome.storage.local
const DEFAULTS = {
  baseURL: 'http://127.0.0.1:11434',
  model: 'dsh-qwen25:7b',
  targetLang: '简体中文',
  fontScale: 0.95,
  minFontSize: 13,
  maxFontSize: 18,
  translateChinese: false,
  skipNavFooter: false,
  showFab: true,
  shortcut: true,
  autoUnload: true
};

const el = (id) => document.getElementById(id);

function setHint(node, text, kind) {
  node.textContent = text;
  node.className = 'hint' + (kind ? ' ' + kind : '');
}

function loadToForm(cfg) {
  el('baseURL').value = cfg.baseURL;
  el('model').value = cfg.model;
  el('targetLang').value = cfg.targetLang;
  el('fontScale').value = String(cfg.fontScale);
  el('minFontSize').value = String(cfg.minFontSize);
  el('maxFontSize').value = String(cfg.maxFontSize);
  el('translateChinese').checked = !!cfg.translateChinese;
  el('skipNavFooter').checked = !!cfg.skipNavFooter;
  el('showFab').checked = !!cfg.showFab;
  el('shortcut').checked = !!cfg.shortcut;
  el('autoUnload').checked = cfg.autoUnload !== false;
  el('fontScaleHint').textContent = '相对原文 ' + Math.round(cfg.fontScale * 100) + '%';
}

function readForm() {
  let min = parseInt(el('minFontSize').value, 10);
  let max = parseInt(el('maxFontSize').value, 10);
  if (!isFinite(min) || min < 10) min = 10;
  if (!isFinite(max) || max < 12) max = 12;
  if (max < min) max = min;
  return {
    baseURL: el('baseURL').value.trim() || DEFAULTS.baseURL,
    model: el('model').value.trim() || DEFAULTS.model,
    targetLang: el('targetLang').value,
    fontScale: parseFloat(el('fontScale').value) || 0.95,
    minFontSize: min,
    maxFontSize: max,
    translateChinese: el('translateChinese').checked,
    skipNavFooter: el('skipNavFooter').checked,
    showFab: el('showFab').checked,
    shortcut: el('shortcut').checked,
    autoUnload: el('autoUnload').checked
  };
}

async function init() {
  let cfg = Object.assign({}, DEFAULTS);
  try {
    const got = await chrome.storage.local.get(Object.keys(DEFAULTS));
    for (const k of Object.keys(DEFAULTS)) {
      if (got[k] !== undefined && got[k] !== null) cfg[k] = got[k];
    }
  } catch (e) {}
  loadToForm(cfg);

  el('fontScale').addEventListener('input', () => {
    el('fontScaleHint').textContent = '相对原文 ' + Math.round(parseFloat(el('fontScale').value) * 100) + '%';
  });

  el('saveBtn').addEventListener('click', async () => {
    const cfgNow = readForm();
    await chrome.storage.local.set(cfgNow);
    loadToForm(cfgNow);
    const st = el('saveState');
    st.classList.add('show');
    st.style.opacity = '1';
    setTimeout(() => { st.style.opacity = '0'; }, 1600);
  });

  el('resetBtn').addEventListener('click', async () => {
    await chrome.storage.local.set(DEFAULTS);
    loadToForm(DEFAULTS);
    setHint(el('pingHint'), '已恢复默认设置', 'ok');
  });

  el('pingBtn').addEventListener('click', async () => {
    const btn = el('pingBtn');
    const hint = el('pingHint');
    btn.disabled = true;
    setHint(hint, '连接中…');
    const base = (el('baseURL').value.trim() || DEFAULTS.baseURL).replace(/\/+$/, '');
    try {
      const res = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      const names = (data.models || []).map((m) => m.name);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (!names.length) {
        setHint(hint, '连上了，但没有已下载的模型', 'bad');
      } else {
        const dl = el('modelList');
        dl.innerHTML = '';
        for (const n of names) {
          const opt = document.createElement('option');
          opt.value = n;
          dl.appendChild(opt);
        }
        const has = names.indexOf(el('model').value.trim()) >= 0;
        setHint(hint, '连接正常，发现 ' + names.length + ' 个模型：' + names.join('、') + (has ? '' : '（当前填写的模型不在列表里）'), has ? 'ok' : 'bad');
      }
    } catch (err) {
      setHint(hint, '连不上：' + (err && err.message ? err.message : err) + '。确认 Ollama 已启动（E:\\Ollama\\serve.cmd）', 'bad');
    } finally {
      btn.disabled = false;
    }
  });

  el('unloadBtn').addEventListener('click', async () => {
    const btn = el('unloadBtn');
    const hint = el('unloadHint');
    btn.disabled = true;
    setHint(hint, '正在停止…');
    const base = (el('baseURL').value.trim() || DEFAULTS.baseURL).replace(/\/+$/, '');
    try {
      const ps = await fetch(base + '/api/ps', { signal: AbortSignal.timeout(3000) });
      const j = await ps.json();
      const loaded = (j.models || []).map((m) => m.name);
      if (!loaded.length) {
        setHint(hint, '当前没有加载的模型（显存本来就空着）', 'ok');
        return;
      }
      for (const name of loaded) {
        await fetch(base + '/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: name, keep_alive: 0 }),
          signal: AbortSignal.timeout(6000)
        });
      }
      setHint(hint, '已停止 ' + loaded.length + ' 个模型，显存已释放', 'ok');
    } catch (err) {
      setHint(hint, '停止失败：' + (err && err.message ? err.message : err), 'bad');
    } finally {
      btn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
