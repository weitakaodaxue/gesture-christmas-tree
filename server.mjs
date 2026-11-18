import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const LOG = path.join(__dirname, 'access.log');
const TOKEN_FILE = path.join(__dirname, '.stats-token');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';

let token;
try {
  token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
} catch {
  token = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.binarypb': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf);
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function logHit(req, urlPath) {
  const rec = {
    t: new Date().toISOString(),
    ip: clientIp(req),
    country: req.headers['cf-ipcountry'] || '',
    path: urlPath,
    ua: String(req.headers['user-agent'] || '').slice(0, 160),
    ref: String(req.headers['referer'] || '').slice(0, 160),
  };
  fs.appendFile(LOG, JSON.stringify(rec) + '\n', () => {});
}

function readLog(limit = 3000) {
  try {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n');
    return lines.slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statsPage(records) {
  const byIp = new Map();
  for (const r of records) {
    const key = r.ip;
    if (!byIp.has(key)) byIp.set(key, { ip: key, country: r.country, hits: 0, first: r.t, last: r.t, ua: r.ua });
    const e = byIp.get(key);
    e.hits += 1;
    if (r.t < e.first) e.first = r.t;
    if (r.t > e.last) e.last = r.t;
    e.ua = r.ua;
  }
  const rows = [...byIp.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
  const rowsHtml = rows.map((r) => `<tr>
    <td>${escapeHtml(r.ip)}</td>
    <td>${escapeHtml(r.country)}</td>
    <td>${r.hits}</td>
    <td>${escapeHtml(r.first.replace('T', ' ').slice(0, 19))}</td>
    <td>${escapeHtml(r.last.replace('T', ' ').slice(0, 19))}</td>
    <td class="ua">${escapeHtml(r.ua)}</td>
  </tr>`).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>访问记录</title>
<style>
  body{background:#0b1016;color:#dbe7f3;font:14px/1.6 -apple-system,"Microsoft YaHei",sans-serif;margin:0;padding:24px}
  h1{font-size:18px;font-weight:600;margin:0 0 4px}
  p.sub{color:#7f93ad;margin:0 0 18px;font-size:12px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{border-bottom:1px solid rgba(120,160,200,.15);padding:8px 10px;text-align:left;vertical-align:top}
  th{color:#8fb0d0;font-weight:500;font-size:12px;white-space:nowrap}
  td.ua{color:#7f93ad;font-size:11px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  tr:hover td{background:rgba(80,140,200,.08)}
  .empty{color:#7f93ad;padding:24px 0}
</style></head><body>
<h1>访问记录</h1>
<p class="sub">共 ${rows.length} 个 IP · ${records.length} 次请求 · 仅记录首页与页面资源加载，不记录摄像头画面</p>
${rows.length ? `<table><thead><tr><th>IP</th><th>国家/地区</th><th>请求</th><th>首次</th><th>最近</th><th>浏览器</th></tr></thead><tbody>${rowsHtml}</tbody></table>` : '<div class="empty">还没有访问记录。</div>'}
</body></html>`;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const urlPath = decodeURIComponent(u.pathname);

  if (urlPath === '/__stats' || urlPath === '/__stats.html') {
    if (u.searchParams.get('k') !== token) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const html = statsPage(readLog());
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
    return;
  }

  if (urlPath.startsWith('/__log.json')) {
    if (u.searchParams.get('k') !== token) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(readLog(5000), null, 2));
    return;
  }

  logHit(req, urlPath);

  let rel = urlPath === '/' ? '/index.html' : urlPath;
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`本地服务已启动: http://${HOST}:${PORT}`);
  console.log(`访问统计页:   http://${HOST}:${PORT}/__stats?k=${token}`);
  console.log(`记录文件:     ${LOG}`);
});