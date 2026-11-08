// 로컬 서버: node scripts/serve.mjs [포트]
//  - dist/ 정적 파일 + /api/discover, /api/import-list (Supabase 함수와 같은 코드)
//  - .env.local의 TOUR_API_KEY를 서버에서만 읽어요. 같은 Wi‑Fi의 휴대폰에서도 접속할 수 있어요.
import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { discover } from '../supabase/functions/_shared/tour.js';
import { importList } from '../supabase/functions/_shared/lists.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', 'dist');
const port = Number(process.argv[2] || process.env.PORT || 8090);
let KEY = process.env.TOUR_API_KEY || '';
try { KEY ||= (/^\s*TOUR_API_KEY\s*=\s*(\S+)/m.exec(readFileSync(path.resolve(here, '..', '.env.local'), 'utf8')) || [])[1] || ''; } catch { /* 키 없음 → 기본 추천만 */ }
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const sendJson = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
const hide = (s) => (KEY ? String(s).split(KEY).join('***') : String(s));

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/discover') {
    if (!KEY) return sendJson(res, 503, { error: 'TOUR_API_KEY가 설정되지 않았어요.' });
    try { return sendJson(res, 200, await discover(KEY, url.searchParams.get('region') || 'sg')); }
    catch (e) { console.warn('[discover]', hide(e.message)); return sendJson(res, e.status || 502, { error: hide(e.message) }); }
  }
  if (url.pathname === '/api/import-list') {
    try { return sendJson(res, 200, await importList(url.searchParams.get('url') || '')); }
    catch (e) { console.warn('[import-list]', e.message); return sendJson(res, e.status || 502, { error: e.message }); }
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  console.log(`주말에 어디가지? → http://localhost:${port}` + (lan ? `  (휴대폰: http://${lan.address}:${port})` : ''));
  console.log(KEY ? '인기 장소 API: .env.local 키 사용' : '인기 장소 API: 키 없음 → 기본 추천만');
});
