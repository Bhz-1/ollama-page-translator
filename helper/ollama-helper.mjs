// ollama-helper.mjs — 本地小助手：让浏览器扩展能「点一下就把 Ollama 拉起来」。
// 浏览器扩展受沙箱限制不能启动进程，只能请求这个本地端口，由它去启动 Ollama。
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 11500;
const OLLAMA = 'http://127.0.0.1:11434';
const OLLAMA_EXE = 'E:\\Ollama\\app\\ollama.exe';
const OLLAMA_MODELS = 'E:\\Ollama\\models';

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function probeOllama(timeout) {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(timeout || 2500) });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

function startOllama() {
  const child = spawn(OLLAMA_EXE, ['serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, {
      OLLAMA_MODELS: OLLAMA_MODELS,
      OLLAMA_HOST: '127.0.0.1:11434',
      OLLAMA_ORIGINS: 'chrome-extension://*',
      OLLAMA_CONTEXT_LENGTH: '16384'
    })
  });
  child.unref();
  return child.pid;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/health') {
    const t0 = Date.now();
    const tags = await probeOllama(2500);
    json(res, 200, {
      ok: true,
      helper: true,
      ollama: !!tags,
      models: tags && tags.models ? tags.models.map((m) => m.name) : [],
      latencyMs: Date.now() - t0
    });
    return;
  }

  if (url.pathname === '/ensure') {
    let tags = await probeOllama(2500);
    if (tags) {
      json(res, 200, {
        ok: true,
        started: false,
        models: tags.models.map((m) => m.name)
      });
      return;
    }

    let pid = null;
    let startError = null;
    try {
      pid = startOllama();
    } catch (e) {
      startError = String(e && e.message || e);
    }

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      tags = await probeOllama(700);
      if (tags) {
        json(res, 200, {
          ok: true,
          started: true,
          pid: pid,
          waitedMs: (i + 1) * 500,
          models: tags.models.map((m) => m.name)
        });
        return;
      }
    }

    json(res, 503, {
      ok: false,
      started: false,
      pid: pid,
      error: startError || 'Ollama 启动超时（30 秒没起来）'
    });
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[helper] listening on http://127.0.0.1:' + PORT);
});
