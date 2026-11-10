import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DIR = 'E:/Ollama/models/import';
const BASE = 'https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-7B-Instruct-GGUF/repo?Revision=master&FilePath=';
const FILES = [
  ['qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf', 3993201344],
  ['qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf', 689872288]
];

fs.mkdirSync(DIR, { recursive: true });
const t0 = Date.now();

for (const [name, size] of FILES) {
  const dest = path.join(DIR, name);
  let start = 0;
  try { start = fs.statSync(dest).size; } catch (e) {}
  if (start >= size) { console.log('[skip]', name, 'already complete'); continue; }

  const url = BASE + encodeURIComponent(name);
  const headers = start > 0 ? { Range: 'bytes=' + start + '-' } : {};
  console.log('[get]', name, 'from', (start / 1048576).toFixed(0), 'MB');
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(3600000) });
  if (res.status !== 200 && res.status !== 206) {
    console.log('[ERR]', name, 'status', res.status);
    process.exit(1);
  }

  const ws = fs.createWriteStream(dest, { flags: start > 0 ? 'a' : 'w' });
  let bytes = start;
  let lastPct = -10;
  let lastT = Date.now();

  const reader = Readable.fromWeb(res.body);
  reader.on('data', (chunk) => {
    bytes += chunk.length;
    const pct = Math.floor(bytes / size * 100);
    if (pct >= lastPct + 10) {
      const sec = (Date.now() - t0) / 1000;
      console.log('[dl]', name.slice(-11), pct + '%', (bytes / 1048576).toFixed(0) + '/' + (size / 1048576).toFixed(0) + ' MB', '@', (bytes / 1048576 / sec).toFixed(2) + ' MB/s avg');
      lastPct = pct;
      lastT = Date.now();
    }
  });

  await pipeline(reader, ws);
  console.log('[done]', name, (bytes / 1048576).toFixed(0), 'MB');
}

console.log('[all done]', ((Date.now() - t0) / 1000).toFixed(0), 's');
