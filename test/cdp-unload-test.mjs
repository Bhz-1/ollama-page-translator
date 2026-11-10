const LIST = 'http://127.0.0.1:9444/json/list';

async function psModels() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch (e) { return ['ERR:' + e.message]; }
}

async function main() {
  const targets = await fetch(LIST).then(r => r.json());
  const page = targets.find(t => t.type === 'page' && t.url.indexOf('8899') >= 0);
  if (!page) { console.log('NO PAGE'); return; }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const val = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await new Promise((r) => { ws.onopen = r; });

  await send('Page.enable', {});
  await send('Page.reload', {});
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 1000));
  console.log('fab:', await val("!!document.getElementById('dsh-pt-fab')"));
  console.log('models before:', JSON.stringify(await psModels()));

  await val("window.scrollTo(0,0); document.getElementById('dsh-pt-fab').click(); 'clicked'");

  let done = 0;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await val("JSON.stringify({t: document.querySelectorAll('[data-dsh-pt]').length, d: document.querySelectorAll('.dsh-pt-done').length, s: (document.getElementById('dsh-pt-fab')||{}).className})");
    const o = JSON.parse(st);
    if (o.d !== done) { console.log('t+' + ((i+1)*2) + 's', st, '| models:', JSON.stringify(await psModels())); done = o.d; }
    if (o.s && o.s.indexOf('done') >= 0 && o.d >= o.t && o.t > 0) break;
  }

  console.log('--- 等自动卸载 ---');
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const m = await psModels();
    console.log('t+' + (i+1) + 's models:', JSON.stringify(m));
    if (!m.length) break;
  }

  console.log('toast:', await val("(document.getElementById('dsh-pt-toast')||{}).textContent"));
  ws.close();
}
main().catch(e => console.log('ERR', e.message));
