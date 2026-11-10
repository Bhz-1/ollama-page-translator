// content.js — 页面注入：右侧悬浮按钮 + 段落收集 + 译文插入（文档流，不遮挡）
(() => {
  'use strict';
  if (window.__DSH_PT_LOADED__) return;
  window.__DSH_PT_LOADED__ = true;

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

  let S = Object.assign({}, DEFAULTS);
  let state = 'idle';
  let port = null;
  let seq = 0;
  const pending = new Map();
  let queue = [];
  let aborted = false;
  let stats = { done: 0, total: 0, failed: 0 };
  const cache = new Map();
  let fab = null;
  let toastEl = null;

  /* ========== 设置 ========== */
  async function loadSettings() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      const got = await chrome.storage.local.get(Object.keys(DEFAULTS));
      for (const k of Object.keys(DEFAULTS)) {
        if (got[k] !== undefined && got[k] !== null) S[k] = got[k];
      }
    } catch (e) { /* 用默认值 */ }
  }

  /* ========== 与 background 通信 ========== */
  function ensurePort() {
    if (port) return port;
    try {
      port = chrome.runtime.connect({ name: 'dsh-pt' });
    } catch (e) {
      port = null;
      throw new Error('扩展上下文已失效，请刷新页面后再试');
    }
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => { port = null; });
    return port;
  }

  function onPortMessage(msg) {
    if (!msg || !msg.id) return;
    const job = pending.get(msg.id);
    if (!job) return;
    if (msg.type === 'chunk') {
      if (job.onDelta) job.onDelta(msg.delta || '');
    } else if (msg.type === 'done') {
      pending.delete(msg.id);
      job.resolve(msg.text || '');
    } else if (msg.type === 'error') {
      pending.delete(msg.id);
      job.reject(new Error(msg.message || '翻译失败'));
    } else if (msg.type === 'ensured') {
      pending.delete(msg.id);
      job.resolve({ ok: msg.ok, started: msg.started, message: msg.message, waitedMs: msg.waitedMs });
    } else if (msg.type === 'unloaded') {
      pending.delete(msg.id);
      job.resolve({ ok: msg.ok, count: msg.count, models: msg.models, message: msg.message });
    }
  }

  function requestTranslate(text, onDelta) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const p = ensurePort();
      pending.set(id, { onDelta, resolve, reject });
      p.postMessage({
        type: 'translate',
        id,
        text,
        baseURL: S.baseURL,
        model: S.model,
        targetLang: S.targetLang
      });
    });
  }

  function ensureOllama() {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const p = ensurePort();
      pending.set(id, { onDelta: null, resolve, reject });
      p.postMessage({ type: 'ensure', id, baseURL: S.baseURL });
    });
  }

  function unloadModels() {
    return new Promise((resolve) => {
      const id = ++seq;
      const p = ensurePort();
      pending.set(id, { onDelta: null, resolve, reject: () => resolve({ ok: false }) });
      p.postMessage({ type: 'unload', id, baseURL: S.baseURL });
    });
  }

  function friendlyError(err) {
    const m = String((err && err.message) || err || '');
    if (/out of memory|failed to load model|unable to allocate|CUDA error|cudaMalloc|no space left/i.test(m)) {
      return '显存不足，模型加载失败（先关游戏，或换更小的模型）';
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
      return '连不上 Ollama（服务被杀了；再点一次按钮会自动拉起）';
    }
    if (/not found|try pulling/i.test(m)) {
      return m + '（设置里换成本机已有的模型名）';
    }
    return m || '未知错误';
  }

  /* ========== 工具 ========== */
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'dsh-pt-toast';
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    const dur = ms || 2600;
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = 'dshPtToast ' + dur + 'ms ease forwards';
  }

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'BUTTON', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'SVG', 'CANVAS', 'IFRAME',
    'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'TEMPLATE', 'HEAD', 'META', 'LINK',
    'TITLE', 'MAP', 'AREA', 'PICTURE', 'SOURCE', 'TRACK'
  ]);

  const SEMANTIC_BLOCK = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DD', 'DT',
    'BLOCKQUOTE', 'FIGCAPTION', 'SUMMARY', 'CAPTION', 'LEGEND', 'ADDRESS',
    'ARTICLE', 'SECTION', 'MAIN', 'ASIDE', 'DIV', 'NAV', 'HEADER', 'FOOTER',
    'FORM', 'FIELDSET', 'DETAILS'
  ]);

  const NAV_TAGS = new Set(['NAV', 'HEADER', 'FOOTER']);

  function skippedByAncestor(el) {
    let n = el;
    let depth = 0;
    while (n && n !== document.body && depth++ < 40) {
      if (n.nodeType === 1) {
        if (SKIP_TAGS.has(n.tagName)) return true;
        if (n.isContentEditable) return true;
        if (n.hasAttribute('data-dsh-pt')) return true;
        if (n.getAttribute('aria-hidden') === 'true') return true;
        if (n.classList && n.classList.contains('dsh-pt-box')) return true;
      }
      n = n.parentElement;
    }
    return false;
  }

  function blockUnitFor(node) {
    let el = node.parentElement;
    let depth = 0;
    while (el && el !== document.body && depth++ < 60) {
      const tag = el.tagName;
      if (SEMANTIC_BLOCK.has(tag)) {
        const cs = getComputedStyle(el);
        if (cs.display === 'inline' || cs.display === 'contents') {
          el = el.parentElement;
          continue;
        }
        return el;
      }
      const cs = getComputedStyle(el);
      if (/^(block|list-item|table-cell|table-caption|flow-root)$/.test(cs.display)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function shouldTranslate(text) {
    const letters = text.replace(/[^\p{L}]/gu, '');
    if (letters.length < 2) return false;
    if (S.translateChinese) return true;
    const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    if (kana > 0) return true;
    const han = (text.match(/\p{Script=Han}/gu) || []).length;
    return han / letters.length < 0.5;
  }

  function collectUnits() {
    if (!document.body) return [];
    const map = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const t = node.nodeValue;
        if (!t || !t.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (skippedByAncestor(p)) return NodeFilter.FILTER_REJECT;
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    let guard = 0;
    while ((node = walker.nextNode()) && guard++ < 6000) {
      const el = blockUnitFor(node);
      if (!el) continue;
      if (S.skipNavFooter) {
        let n = el, d = 0, inNav = false;
        while (n && n !== document.body && d++ < 20) {
          if (NAV_TAGS.has(n.tagName)) { inNav = true; break; }
          n = n.parentElement;
        }
        if (inNav) continue;
      }
      const rec = map.get(el);
      if (rec) rec.extra += ' ' + node.nodeValue.trim();
      else map.set(el, { el, extra: '' });
    }

    const units = [];
    for (const rec of map.values()) {
      const el = rec.el;
      if (!el.isConnected) continue;
      let raw = '';
      try { raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); } catch (e) { raw = ''; }
      if (!raw) raw = rec.extra.trim();
      if (raw.length < 2) continue;
      if (raw.length > 4000) raw = raw.slice(0, 4000);
      if (!shouldTranslate(raw)) continue;
      const cs = getComputedStyle(el);
      if (cs.float !== 'none') continue;
      if (cs.position === 'fixed' && el.getBoundingClientRect().width >= window.innerWidth * 0.8) continue;
      if (el.querySelector('[data-dsh-pt]')) continue;
      units.push({ el, text: raw });
    }
    return units;
  }

  /* ========== 插入译文 ========== */
  function fontSizeFor(el) {
    let px = 16;
    try {
      const cs = getComputedStyle(el);
      px = parseFloat(cs.fontSize) || 16;
    } catch (e) {}
    const scaled = Math.round(px * (S.fontScale || 0.95));
    return Math.max(S.minFontSize || 13, Math.min(S.maxFontSize || 18, scaled));
  }

  function createBox(unit, index) {
    const box = document.createElement('span');
    box.className = 'dsh-pt-box';
    box.setAttribute('data-dsh-pt', '1');
    box.setAttribute('data-dsh-pt-idx', String(index));
    box.style.fontSize = fontSizeFor(unit.el) + 'px';

    const tag = document.createElement('span');
    tag.className = 'dsh-pt-tag';
    tag.textContent = '译';

    const body = document.createElement('span');
    body.className = 'dsh-pt-body';

    box.appendChild(tag);
    box.appendChild(body);

    if (!placeBox(unit.el, box)) return null;
    return { box, body };
  }

  function placeBox(el, box) {
    let target = el;
    let guard = 0;
    while (target && target !== document.body && guard++ < 8) {
      const cs = getComputedStyle(target);
      const isFlexGrid = /flex|grid/.test(cs.display) && cs.display.indexOf('inline') !== 0;
      const csOverflow = String(cs.overflow) + ' ' + String(cs.overflowY);
      const hidesOverflow = /hidden|clip/.test(csOverflow);
      if (isFlexGrid || hidesOverflow) {
        target = target.parentElement;
        continue;
      }
      break;
    }
    if (!target || target === document.body || target === document.documentElement) {
      if (!el.parentElement) return false;
      el.insertAdjacentElement('afterend', box);
      return true;
    }
    try {
      target.appendChild(box);
    } catch (e) {
      return false;
    }
    return true;
  }

  function setBoxState(box, kind, text) {
    box.box.classList.remove('dsh-pt-loading', 'dsh-pt-error', 'dsh-pt-done');
    if (kind) box.box.classList.add('dsh-pt-' + kind);
    if (text !== undefined) box.body.textContent = text;
  }

  function removeBox(box) {
    if (box && box.box && box.box.parentNode) box.box.parentNode.removeChild(box.box);
  }

  /* ========== 悬浮按钮 ========== */
  function injectFab() {
    if (fab || !document.body) return;
    if (!S.showFab) return;
    fab = document.createElement('div');
    fab.id = 'dsh-pt-fab';
    fab.setAttribute('role', 'button');
    fab.setAttribute('tabindex', '0');
    fab.title = '点我翻译本页 · 双击打开设置 · 右键停止模型';
    fab.innerHTML = '<span class="dsh-pt-fab-icon">译</span><span class="dsh-pt-fab-label">翻译</span>';
    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (fab._dbl) { fab._dbl = false; return; }
      onFabClick();
    });
    fab.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fab._dbl = true;
      try { chrome.runtime.openOptionsPage(); } catch (err) {}
    });
    fab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFabClick(); }
    });
    fab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      unloadModels().then((r) => {
        if (r && r.ok) {
          toast(r.count ? '已停止模型，显存已释放' : '当前没有加载的模型', 4000);
        } else {
          toast('停止失败：' + ((r && r.message) || '未知原因'), 4000);
        }
      }).catch(() => { toast('停止失败：连不上服务', 4000); });
    });
    (document.body || document.documentElement).appendChild(fab);
    setFabState(state);
  }

  function setFabState(st) {
    if (!fab) return;
    fab.className = 'dsh-pt-state-' + st;
    const label = fab.querySelector('.dsh-pt-fab-label');
    const icon = fab.querySelector('.dsh-pt-fab-icon');
    if (st === 'running') {
      if (label) label.textContent = '停止';
      if (icon) icon.textContent = '停';
    } else if (st === 'done') {
      if (label) label.textContent = '还原';
      if (icon) icon.textContent = '原';
    } else {
      if (label) label.textContent = '翻译';
      if (icon) icon.textContent = '译';
    }
  }

  async function onFabClick() {
    if (state === 'running') { stopTranslate(); return; }
    if (state === 'done') { restore(); return; }
    await startTranslate();
  }

  /* ========== 主流程 ========== */
  async function startTranslate() {
    await loadSettings();
    if (!document.body) return;

    toast('检查 Ollama 服务…', 4000);
    const ens = await ensureOllama().catch(() => ({ ok: false, message: '连接本地助手失败' }));
    if (ens.ok === false) {
      toast(ens.message || '拉不起 Ollama', 7000);
      return;
    }
    if (ens.started) toast('Ollama 已拉起，开始翻译…', 3000);

    const units = collectUnits();
    if (!units.length) {
      toast('没找到可翻译的文本（可能已是中文，或页面是图片/画布）');
      return;
    }
    queue = units;
    aborted = false;
    stats = { done: 0, total: units.length, failed: 0 };
    state = 'running';
    setFabState('running');
    toast('开始翻译 ' + units.length + ' 段，本地模型较慢，请稍候');

    for (let i = 0; i < queue.length; i++) {
      if (aborted) break;
      const unit = queue[i];
      await translateUnit(unit, i);
      if (aborted) break;
      stats.done++;
      updateProgress();
    }

    if (!aborted) {
      state = 'done';
      setFabState('done');
      startObserver();
      const failed = stats.failed ? '，' + stats.failed + ' 段失败' : '';
      const summary = '翻译完成：' + stats.done + '/' + stats.total + ' 段' + failed;
      if (S.autoUnload) {
        unloadModels().then((r) => {
          if (r && r.ok && r.count) toast(summary + ' · 模型已卸载，显存释放', 5000);
          else toast(summary, 4000);
        }).catch(() => { toast(summary, 4000); });
      } else {
        toast(summary, 4000);
      }
    } else {
      state = 'idle';
      setFabState('idle');
      toast('已停止');
    }
  }

  function updateProgress() {
    if (state !== 'running') return;
    const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    toast('翻译中 ' + stats.done + '/' + stats.total + '（' + pct + '%）', 60000);
  }

  async function translateUnit(unit, index) {
    const box = createBox(unit, index);
    if (!box) return;
    const key = S.model + '|' + S.targetLang + '|' + unit.text;

    const cached = cache.get(key);
    if (cached) {
      setBoxState(box, 'done', cached);
      return;
    }

    setBoxState(box, 'loading', '翻译中…');
    let acc = '';
    try {
      const full = await requestTranslate(unit.text, (delta) => {
        acc += delta;
        setBoxState(box, 'loading', acc);
      });
      const out = (full || acc).trim();
      if (!out) {
        removeBox(box);
        stats.failed++;
        return;
      }
      setBoxState(box, 'done', out);
      cache.set(key, out);
    } catch (err) {
      if (aborted) { removeBox(box); return; }
      setBoxState(box, 'error', '翻译失败：' + friendlyError(err));
      stats.failed++;
    }
  }

  function stopTranslate() {
    aborted = true;
    for (const [id, job] of pending) {
      try { port && port.postMessage({ type: 'abort', id }); } catch (e) {}
      job.reject(new Error('已取消'));
    }
    pending.clear();
  }

  function restore() {
    stopTranslate();
    stopObserver();
    const boxes = document.querySelectorAll('[data-dsh-pt]');
    boxes.forEach((b) => { if (b.parentNode) b.parentNode.removeChild(b); });
    state = 'idle';
    setFabState('idle');
    toast('已还原原文');
  }

  /* ========== 动态浮层（下拉菜单等）增量翻译 ========== */
  let observer = null;
  let dynTimer = null;

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (dynTimer) { clearTimeout(dynTimer); dynTimer = null; }
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver((mutations) => {
      if (state !== 'done') return;
      let relevant = false;
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.hasAttribute && n.hasAttribute('data-dsh-pt')) continue;
          if (n.classList && n.classList.contains('dsh-pt-box')) continue;
          relevant = true;
          break;
        }
        if (relevant) break;
      }
      if (!relevant) return;
      if (dynTimer) clearTimeout(dynTimer);
      dynTimer = setTimeout(() => {
        dynTimer = null;
        translateDynamic();
      }, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function translateDynamic() {
    if (state !== 'done' || !document.body) return;
    let units;
    try { units = collectUnits(); } catch (e) { return; }
    if (!units.length) return;
    const fresh = units.slice(0, 40);
    for (const unit of fresh) {
      if (state !== 'done') return;
      await translateUnit(unit, 9000);
    }
  }

  /* ========== 快捷键 ========== */
  document.addEventListener('keydown', (e) => {
    if (!S.shortcut) return;
    if (e.ctrlKey && e.altKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      onFabClick();
    }
  }, true);

  /* ========== 启动 ========== */
  async function boot() {
    await loadSettings();
    if (!S.showFab) return;
    if (document.body) injectFab();
    else document.addEventListener('DOMContentLoaded', injectFab, { once: true });
  }

  boot();
})();
