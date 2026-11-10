import fs from 'node:fs';
import path from 'node:path';

const DIR = 'E:/Ollama/models/import';
const PARTS = [
  'qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf',
  'qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf'
];
const OUT = path.join(DIR, 'qwen2.5-7b-instruct-q4_k_m.gguf');

let total = 0;
const ws = fs.createWriteStream(OUT);
for (const p of PARTS) {
  const full = path.join(DIR, p);
  const size = fs.statSync(full).size;
  await new Promise((resolve, reject) => {
    const rs = fs.createReadStream(full);
    rs.on('data', (c) => { total += c.length; });
    rs.on('error', reject);
    rs.on('end', resolve);
    rs.pipe(ws, { end: false });
  });
  console.log('[part]', p, (size / 1048576).toFixed(0), 'MB');
}
await new Promise((r) => ws.end(r));
const st = fs.statSync(OUT);
console.log('[merged]', OUT, (st.size / 1048576).toFixed(0), 'MB', '| total written', (total / 1048576).toFixed(0), 'MB');
