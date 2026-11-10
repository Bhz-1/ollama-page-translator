const LIST = 'http://127.0.0.1:9444/json/list';
async function main() {
  const targets = await fetch(LIST).then(r => r.json());
  const page = targets.find(t => t.type === 'page' && t.url.indexOf('8899') >= 0);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const val = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
  await new Promise((r) => { ws.onopen = r; });

  console.log('before restore:', await val("JSON.stringify({boxes: document.querySelectorAll('[data-dsh-pt]').length, fab: (document.getElementById('dsh-pt-fab')||{}).className})"));
  await val("document.getElementById('dsh-pt-fab').click(); 'clicked'");
  await new Promise(r => setTimeout(r, 1500));
  console.log('after restore :', await val("JSON.stringify({boxes: document.querySelectorAll('[data-dsh-pt]').length, fab: (document.getElementById('dsh-pt-fab')||{}).className, toast: (document.getElementById('dsh-pt-toast')||{}).textContent})"));

  // 再点一次，应重新开始翻译
  await val("document.getElementById('dsh-pt-fab').click(); 'clicked again'");
  await new Promise(r => setTimeout(r, 4000));
  console.log('re-translate :', await val("JSON.stringify({boxes: document.querySelectorAll('[data-dsh-pt]').length, state: (document.getElementById('dsh-pt-fab')||{}).className})"));

  // 停止
  await val("document.getElementById('dsh-pt-fab').click(); 'stop'");
  await new Promise(r => setTimeout(r, 2000));
  console.log('after stop   :', await val("JSON.stringify({boxes: document.querySelectorAll('[data-dsh-pt]').length, state: (document.getElementById('dsh-pt-fab')||{}).className, toast: (document.getElementById('dsh-pt-toast')||{}).textContent})"));
  ws.close();
}
main().catch(e => console.log('ERR', e.message));
