const LIST = 'http://127.0.0.1:9444/json/list';

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
    if (r.result && r.result.exceptionDetails) return 'EXC:' + JSON.stringify(r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await new Promise((r) => { ws.onopen = r; });

  await send('Page.enable', {});
  await send('Page.reload', {});
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 1000));
  console.log('fab present:', await val("!!document.getElementById('dsh-pt-fab')"));

  await val("window.scrollTo(0,0); document.getElementById('dsh-pt-fab').click(); 'clicked'");

  let done = 0;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await val("JSON.stringify({t: document.querySelectorAll('[data-dsh-pt]').length, d: document.querySelectorAll('.dsh-pt-done').length, e: document.querySelectorAll('.dsh-pt-error').length, s: (document.getElementById('dsh-pt-fab')||{}).className})");
    const o = JSON.parse(st);
    if (o.d !== done) { console.log('t+' + ((i+1)*2) + 's', st); done = o.d; }
    if (o.s && o.s.indexOf('done') >= 0 && (o.d + o.e) >= o.t && o.t > 0) break;
  }

  console.log('--- 打开菜单 ---');
  await val("document.getElementById('menuBtn').click(); 'menu opened'");
  const menuOpen = await val("getComputedStyle(document.getElementById('menu')).display");
  console.log('menu display:', menuOpen);

  let menuBoxes = 0;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const n = await val("document.querySelectorAll('#menu [data-dsh-pt]').length");
    if (n !== menuBoxes) { console.log('menu t+' + (i+1) + 's boxes=' + n); menuBoxes = n; }
    if (menuBoxes >= 7) break;
  }

  const rep = await val("(function(){" +
    "var items=Array.from(document.querySelectorAll('#menu a'));" +
    "var out=items.map(function(a){var b=a.querySelector('[data-dsh-pt]');return {en:(a.textContent||'').trim().slice(0,30),zh:b?(b.textContent||'').trim().slice(0,40):null,pos:b?getComputedStyle(b).position:null};});" +
    "return JSON.stringify({menuDisplay:getComputedStyle(document.getElementById('menu')).display,items:out,total:document.querySelectorAll('[data-dsh-pt]').length},null,1);})()");
  console.log('MENU REPORT', rep);
  ws.close();
}
main().catch(e => console.log('ERR', e.message));
