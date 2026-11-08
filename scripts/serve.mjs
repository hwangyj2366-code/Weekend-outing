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

// 공공데이터포털 응답이 느려(호출당 최대 30초) 인기 장소는 백그라운드에서 만들어 파일로 저장해 둬요.
const CACHE_DIR = path.resolve(here, '..', '.cache');
const FRESH_MS = 12 * 60 * 60 * 1000;
const running = new Map();
async function readCache(region) {
  try { return JSON.parse(await fs.readFile(path.join(CACHE_DIR, `discover-${region}.json`), 'utf8')); } catch { return null; }
}
function refresh(region) {
  if (running.has(region)) return;
  const started = Date.now();
  console.log(`[discover] ${region} 데이터 만들기 시작`);
  running.set(region, discover(KEY, region, true)
    .then(async (body) => {
      // 공공데이터 서버가 불안정하면 이번 결과가 적게 나올 수 있어요. 이전 결과와 합쳐(이번 것 우선) 목록이 줄지 않게 하고,
      // 같은 장소는 비어 있는 위치·운영 정보를 이전 결과로 채워요. 7일 넘은 이전 결과는 버려요.
      const prev = await readCache(region);
      if (prev && Date.now() - new Date(prev.fetchedAt).getTime() < 7 * 24 * 3600 * 1000) {
        const key = (p) => String(p.name).replace(/s/g, '');
        const old = new Map(prev.places.map((p) => [key(p), p]));
        body.places = body.places.map((p) => {
          const o = old.get(key(p));
          return o ? { ...o, ...p, lat: p.lat ?? o.lat, lng: p.lng ?? o.lng, image: p.image || o.image, hours: p.hours || o.hours } : p;
        });
        const have = new Set(body.places.map(key));
        body.places.push(...prev.places.filter((p) => !have.has(key(p))));
        if (!body.popularityNote && prev.popularityNote) body.popularityNote = prev.popularityNote;
      }
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(path.join(CACHE_DIR, `discover-${region}.json`), JSON.stringify(body));
      console.log(`[discover] ${region} 완료: ${body.places.length}곳, ${Math.round((Date.now() - started) / 1000)}초, 실패 호출 ${body.errors.length}건`);
    })
    .catch((e) => console.warn(`[discover] ${region} 실패:`, hide(e.message)))
    .finally(() => running.delete(region)));
}

const sendJson = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body));
const hide = (s) => (KEY ? String(s).split(KEY).join('***') : String(s));

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/discover') {
    if (!KEY) return sendJson(res, 503, { error: 'TOUR_API_KEY가 설정되지 않았어요.' });
    const region = /^[a-z]+$/.test(url.searchParams.get('region') || '') ? url.searchParams.get('region') : 'sg';
    const cached = await readCache(region);
    const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH_MS;
    if (!fresh || url.searchParams.get('refresh')) refresh(region); // 설정의 '다시 불러오기'는 기존 데이터를 보여주면서 새로 만들어요
    if (cached) return sendJson(res, 200, { ...cached, refreshing: !fresh });
    return sendJson(res, 202, { pending: true, message: '인기 장소 데이터를 처음 만드는 중이에요. 몇 분 걸려요.' });
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
