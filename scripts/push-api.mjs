#!/usr/bin/env node
// 通过 GitHub Git Data API 推送当前目录（绕开 github.com 443 被墙时 git push 卡死的问题）
//
// 用法：
//   node scripts/push-api.mjs                    # 推当前分支
//   GH_TOKEN=ghp_xxx node scripts/push-api.mjs   # 用指定 token
//
// 依赖：git（读 origin）、gh（取 token），或直接给 GH_TOKEN。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'https://api.github.com';
const cwd = process.cwd();
const SKIP = new Set(['.git', 'node_modules']);

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', cwd, windowsHide: true }).trim();
}

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const gh = process.env.GH_BIN || 'gh';
  return sh(gh, ['auth', 'token']);
}

function getRepo() {
  const url = sh('git', ['remote', 'get-url', 'origin']);
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!m) throw new Error('无法从 origin 解析 owner/repo: ' + url);
  return m[1] + '/' + m[2];
}

function getBranch() {
  return sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
}

function getMessage() {
  const msg = process.env.COMMIT_MSG;
  if (msg) return msg;
  try { return sh('git', ['log', '-1', '--format=%B']); } catch { return 'chore: sync'; }
}

function collectFiles(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) collectFiles(full, r, out);
    else out.push({ full, path: r });
  }
  return out;
}

async function main() {
  const token = getToken();
  const repo = getRepo();
  const branch = getBranch();

  async function api(method, url, body) {
    const res = await fetch(API + url, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'push-api'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(method + ' ' + url + ' -> ' + res.status + ' ' + text.slice(0, 300));
    return json;
  }

  const files = collectFiles(cwd, '', []);
  console.log('repo:', repo, '| branch:', branch, '| files:', files.length);

  // 空仓库：先落一个 README 产生首个 commit
  let baseSha = null;
  let baseTree = null;
  try {
    const ref = await api('GET', '/repos/' + repo + '/git/ref/heads/' + branch);
    baseSha = ref.object.sha;
    const c = await api('GET', '/repos/' + repo + '/git/commits/' + baseSha);
    baseTree = c.tree.sha;
    console.log('base:', baseSha, 'tree:', baseTree);
  } catch (e) {
    if (!String(e.message).includes('404')) throw e;
    console.log('空仓库，先初始化 README…');
    const readme = files.find((f) => f.path === 'README.md');
    if (!readme) throw new Error('空仓库需要先有 README.md');
    const init = await api('PUT', '/repos/' + repo + '/contents/README.md', {
      message: 'chore: 初始化仓库',
      content: fs.readFileSync(readme.full).toString('base64'),
      branch
    });
    baseSha = init.commit.sha;
  }

  const tree = [];
  for (let i = 0; i < files.length; i += 6) {
    const batch = files.slice(i, i + 6);
    const done = await Promise.all(batch.map(async (f) => {
      const r = await api('POST', '/repos/' + repo + '/git/blobs', {
        content: fs.readFileSync(f.full).toString('base64'),
        encoding: 'base64'
      });
      return { path: f.path, mode: '100644', type: 'blob', sha: r.sha };
    }));
    tree.push(...done);
    console.log('blobs:', tree.length + '/' + files.length);
  }

  const treeRes = await api('POST', '/repos/' + repo + '/git/trees', { base_tree: baseTree || undefined, tree });
  const commitRes = await api('POST', '/repos/' + repo + '/git/commits', {
    message: getMessage(),
    tree: treeRes.sha,
    parents: baseSha ? [baseSha] : [],
    author: { name: 'Bhz-1', email: '346814781+Bhz-1@users.noreply.github.com' }
  });
  await api('PATCH', '/repos/' + repo + '/git/refs/heads/' + branch, { sha: commitRes.sha, force: true });
  console.log('pushed:', commitRes.sha);
  console.log('https://github.com/' + repo);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
