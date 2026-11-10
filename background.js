// background.js — service worker：代理翻译请求到本机 Ollama。
// content script 不直接跨域 fetch（会被页面 CORS 拦），统一由这里转发。

const HELPER = 'http://127.0.0.1:11500';

const DEFAULTS = {
  baseURL: 'http://127.0.0.1:11434',
  model: 'dsh-qwen25:7b',
  targetLang: '简体中文',
  temperature: 0.2,
  numCtx: 8192,
  numPredict: 1024
};

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dsh-pt') return;
  const controllers = new Map();

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    const id = msg.id;
    if (msg.type === 'translate') {
      const ac = new AbortController();
      controllers.set(id, ac);
      handleTranslate(msg, port, ac)
        .catch((err) => {
          post(port, { type: 'error', id, message: errText(err) });
        })
        .finally(() => controllers.delete(id));
    } else if (msg.type === 'abort') {
      const ac = controllers.get(id);
      if (ac) ac.abort();
    } else if (msg.type === 'ping') {
      probe(msg, port);
    } else if (msg.type === 'ensure') {
      ensureOllama(msg, port);
    } else if (msg.type === 'unload') {
      unloadModels(msg, port);
    }
  });

  port.onDisconnect.addListener(() => {
    for (const ac of controllers.values()) {
      try { ac.abort(); } catch (e) {}
    }
    controllers.clear();
  });
});

function post(port, msg) {
  try { port.postMessage(msg); } catch (e) {}
}

function errText(err) {
  if (!err) return '未知错误';
  if (err.name === 'AbortError') return '已取消';
  if (err.name === 'TimeoutError') return '请求超时（模型太慢或未加载）';
  return String(err.message || err);
}

async function probe(msg, port) {
  const base = String(msg.baseURL || DEFAULTS.baseURL).replace(/\/+$/, '');
  try {
    const res = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name);
    post(port, { type: 'pong', id: msg.id, ok: res.ok, models: names });
  } catch (err) {
    post(port, { type: 'pong', id: msg.id, ok: false, message: errText(err) });
  }
}

async function unloadModels(msg, port) {
  const base = String(msg.baseURL || DEFAULTS.baseURL).replace(/\/+$/, '');
  const id = msg.id;
  try {
    const r = await fetch(base + '/api/ps', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    const loaded = (j.models || []).map((m) => m.name);
    if (!loaded.length) {
      post(port, { type: 'unloaded', id, ok: true, count: 0, models: [] });
      return;
    }
    for (const name of loaded) {
      try {
        await fetch(base + '/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: name, keep_alive: 0 }),
          signal: AbortSignal.timeout(6000)
        });
      } catch (e) {}
    }
    post(port, { type: 'unloaded', id, ok: true, count: loaded.length, models: loaded });
  } catch (err) {
    post(port, { type: 'unloaded', id, ok: false, message: errText(err) });
  }
}

async function ensureOllama(msg, port) {
  const base = String(msg.baseURL || DEFAULTS.baseURL).replace(/\/+$/, '');
  const id = msg.id;

  async function reachable() {
    try {
      const r = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(2500) });
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  if (await reachable()) {
    post(port, { type: 'ensured', id, ok: true, started: false });
    return;
  }

  try {
    const r = await fetch(HELPER + '/ensure', { method: 'POST', signal: AbortSignal.timeout(35000) });
    const j = await r.json();
    if (j && j.ok) {
      post(port, { type: 'ensured', id, ok: true, started: !!j.started, waitedMs: j.waitedMs || 0 });
      return;
    }
    post(port, {
      type: 'ensured', id, ok: false,
      message: '本地助手拉不起 Ollama：' + ((j && j.error) || '未知原因')
    });
  } catch (err) {
    if (await reachable()) {
      post(port, { type: 'ensured', id, ok: true, started: false });
      return;
    }
    post(port, {
      type: 'ensured', id, ok: false,
      message: 'Ollama 没在跑，本地助手也没响应（查计划任务 OllamaHelper 是否在运行）'
    });
  }
}

function buildSystemPrompt(targetLang) {
  return [
    '你是专业的网页翻译引擎，把用户给的内容翻译成' + targetLang + '。',
    '必须遵守：',
    '1. 只输出译文本身。不要解释、不要加引号、不要加"翻译如下"这类前缀、不要输出思考过程。',
    '2. 保留原文的行号标记与换行结构，行号原样保留。',
    '3. 专有名词、品牌、人名、代码、命令、URL、邮箱、数字与单位保持原样。',
    '4. 术语要准确，符合中文技术圈习惯；宁可直译，不要臆造。',
    '5. 原文若已是目标语言，原样输出。'
  ].join('\n');
}

const FENCE = String.fromCharCode(96).repeat(3);

function stripThink(text) {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/<think[\s\S]*?<\/think>/gi, '');
  t = t.replace(/^[\s\S]*?<\/think>/i, '');
  const re = new RegExp(FENCE + '(?:markdown|md|text)?\\s*([\\s\\S]*?)' + FENCE, 'g');
  t = t.replace(re, '$1');
  return t.replace(/^\s+/, '').trim();
}

async function handleTranslate(msg, port, ac) {
  const id = msg.id;
  const base = String(msg.baseURL || DEFAULTS.baseURL).replace(/\/+$/, '');
  const model = msg.model || DEFAULTS.model;
  const targetLang = msg.targetLang || DEFAULTS.targetLang;
  const text = String(msg.text || '').slice(0, 16000);
  if (!text.trim()) {
    post(port, { type: 'done', id, text: '' });
    return;
  }

  const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(240000)]);

  const body = {
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt(targetLang) },
      { role: 'user', content: text }
    ],
    stream: true,
    think: false,
    options: {
      temperature: typeof msg.temperature === 'number' ? msg.temperature : DEFAULTS.temperature,
      num_ctx: msg.numCtx || DEFAULTS.numCtx,
      num_predict: msg.numPredict || DEFAULTS.numPredict
    }
  };

  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('Ollama ' + res.status + '：' + detail.slice(0, 300));
  }

  post(port, { type: 'start', id });

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let full = '';
  let thinkBuf = '';
  let sawDone = false;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch (e) { continue; }
      if (obj.error) throw new Error(String(obj.error));
      const m = obj.message || {};
      if (m.thinking) thinkBuf += m.thinking;
      if (m.content) {
        full += m.content;
        post(port, { type: 'chunk', id, delta: m.content });
      }
      if (obj.done) sawDone = true;
    }
  }

  let out = stripThink(full);
  if (!out && thinkBuf) {
    out = stripThink(thinkBuf);
    if (out) post(port, { type: 'chunk', id, delta: out });
  }
  post(port, { type: 'done', id, text: out, sawDone });
}
