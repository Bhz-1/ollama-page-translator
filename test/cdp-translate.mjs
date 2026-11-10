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

  console.log('before:', await val("JSON.stringify({boxes: document.querySelectorAll('[data-dsh-pt]').length, fab: !!document.getElementById('dsh-pt-fab')})"));
  await val("window.scrollTo(0,0); document.getElementById('dsh-pt-fab').click(); 'clicked'");

  let lastDone = -1;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await val("JSON.stringify({total: document.querySelectorAll('[data-dsh-pt]').length, done: document.querySelectorAll('.dsh-pt-done').length, err: document.querySelectorAll('.dsh-pt-error').length, state: (document.getElementById('dsh-pt-fab')||{}).className})");
    const o = JSON.parse(st);
    if (o.done !== lastDone) { console.log('t+' + ((i+1)*3) + 's', st); lastDone = o.done; }
    if (o.state && o.state.indexOf('idle') < 0 && o.state.indexOf('done') >= 0 && o.done === o.total) break;
  }

  const rep = await val("(function(){" +
    "var boxes=Array.from(document.querySelectorAll('[data-dsh-pt]'));" +
    "var vh=window.innerHeight,vw=window.innerWidth;" +
    "var inView=boxes.filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<vh&&r.bottom>0;});" +
    "var covered=inView.filter(function(b){var r=b.getBoundingClientRect();var el=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));return !(el&&(el===b||b.contains(el)));});" +
    "var overlapPairs=0;for(var i=0;i<boxes.length;i++){for(var j=i+1;j<boxes.length;j++){var a=boxes[i].getBoundingClientRect(),c=boxes[j].getBoundingClientRect();if(!(a.right<=c.left||c.right<=a.left||a.bottom<=c.top||c.bottom<=a.top))overlapPairs++;}}" +
    "var sample=boxes.slice(0,5).map(function(b,i){return {i:i,tag:(b.parentElement||{}).tagName,fs:getComputedStyle(b).fontSize,pos:getComputedStyle(b).position,text:(b.textContent||'').trim().slice(0,50)};});" +
    "var clipper=document.querySelector('.clipper');" +
    "var clipperBox=clipper?clipper.querySelector('[data-dsh-pt]'):null;" +
    "var clipperNext=clipper?clipper.nextElementSibling:null;" +
    "var fixedBox=document.querySelector('.fixedbox');" +
    "return JSON.stringify({total:boxes.length,used:document.querySelectorAll('.dsh-pt-done').length,errors:document.querySelectorAll('.dsh-pt-error').length,notInFlow:boxes.filter(function(b){var cs=getComputedStyle(b);return cs.position!=='static'||cs.float!=='none';}).length,tooWide:boxes.filter(function(b){return b.getBoundingClientRect().width>vw;}).length,coveredInView:covered.length,overlapPairs:overlapPairs,clipperInside:!!clipperBox,clipperNextIsBox:clipperNext?clipperNext.hasAttribute('data-dsh-pt'):false,fixedSkipped:fixedBox?!fixedBox.querySelector('[data-dsh-pt]'):true,sample:sample},null,1);})()");
  console.log('REPORT', rep);
  ws.close();
}
main().catch(e => { console.log('ERR', e.message); });
