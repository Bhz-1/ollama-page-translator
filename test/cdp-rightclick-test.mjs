const LIST = 'http://127.0.0.1:9444/json/list';

async function psModels() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch (e) { return ['ERR']; }
}

async function main() {
  // 先把模型加载起来
  console.log('loading model...');
  await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'dsh-qwen25:7b', messages: [{ role: 'user', content: 'hi' }], stream: false, think: false, options: { num_predict: 2 } }),
    signal: AbortSignal.timeout(120000)
  });
  console.log('models loaded:', JSON.stringify(await psModels()));

  const targets = await fetch(LIST).then(r => r.json());
  const page = targets.find(t => t.type === 'page' && t.url.indexOf('8899') >= 0);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const val = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
  await new Promise((r) => { ws.onopen = r; });

  await val("document.getElementById('dsh-pt-fab').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true})); 'rightclicked'");
  console.log('right-click dispatched');

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const m = await psModels();
    console.log('t+' + (i+1) + 's models:', JSON.stringify(m));
    if (!m.length) break;
  }
  console.log('toast:', await val("(document.getElementById('dsh-pt-toast')||{}).textContent"));
  ws.close();
}
main().catch(e => console.log('ERR', e.message));
