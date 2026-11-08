// 공개(일부공개)로 공유한 네이버지도·구글지도 '리스트' 링크에서 장소 목록을 읽어요.
//
// ⚠️ 두 지도 모두 즐겨찾기 리스트용 공식 API가 없어서, 공유 링크를 열면 지도 웹페이지가 쓰는 주소를 그대로 호출해요.
//    지도 서비스가 이 주소를 바꾸면 동작하지 않을 수 있어요. 그때는 앱의 다른 가져오기 방법(공유 문구·Takeout)을 쓰면 돼요.
//    사용자가 직접 공개한 '자기 리스트'를 한 번 읽어 오는 용도로만 씁니다.

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

export class ListError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// 단축 링크(naver.me, maps.app.goo.gl)를 따라가 최종 주소를 얻어요.
// found(주소)가 값을 돌려주면 그 단계에서 멈춰요(네이버는 앱 연결 주소로 몇 번 더 넘어가며 모양이 바뀌어요).
async function resolve(url, found = () => '') {
  let cur = url;
  for (let i = 0; i < 6; i++) {
    if (found(cur)) return cur;
    const res = await fetch(cur, { redirect: 'manual', headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(8000) });
    const loc = res.headers.get('location');
    if (!loc || res.status < 300 || res.status >= 400) {
      // 일부 단축 링크는 HTML 안에서 이동해요.
      if (res.ok && /text\/html/.test(res.headers.get('content-type') || '')) {
        const html = await res.text();
        const m = /(?:url=|location\.(?:href|replace)\(?\s*=?\s*['"])(https?:\/\/[^'"\s>]+)/i.exec(html);
        if (m && m[1] !== cur) { cur = m[1].replace(/&amp;/g, '&'); continue; }
      }
      return cur;
    }
    cur = new URL(loc, cur).href;
    // 구글 동의 화면을 거치면 continue 값이 원래 주소예요.
    const u = new URL(cur);
    if (/consent\.google/.test(u.host) && u.searchParams.get('continue')) return u.searchParams.get('continue');
  }
  return cur;
}

export function detectProvider(url) {
  const h = (() => { try { return new URL(url).host; } catch { return ''; } })();
  if (/naver\.me|naver\.com/.test(h)) return 'naver';
  if (/goo\.gl|google\./.test(h)) return 'google';
  return '';
}

// ---------- 네이버지도 ----------
// naver.me/xxxx → map.naver.com/p/favorite/sharedPlace/folder/{id}
//              → map.naver.com/appLink.naver?appTargetPage=bookmark/share&id={id}&fallbackUrl=…/detail-list/{id}
export function naverShareId(url) {
  let u = String(url || '');
  try { u = decodeURIComponent(u); } catch { /* 그대로 */ }
  const m = /\/folder\/([0-9a-zA-Z_-]{8,})/.exec(u) || /\/shares\/([0-9a-zA-Z_-]{8,})/.exec(u) ||
    /\/detail-list\/([0-9a-zA-Z_-]{8,})/.exec(u) || /[?&]shareId=([0-9a-zA-Z_-]{8,})/.exec(u) ||
    (/bookmark\/share/.test(u) && /[?&]id=([0-9a-zA-Z_-]{8,})/.exec(u));
  return m ? m[1] : '';
}
async function naverList(url) {
  const finalUrl = await resolve(url, naverShareId);
  if (/\/place\/\d+/.test(finalUrl) && !/folder/.test(finalUrl)) {
    throw new ListError('장소 하나의 링크예요. 리스트 전체를 가져오려면 저장 탭의 리스트에서 ⋮ → 공유로 링크를 복사해 주세요.');
  }
  const id = naverShareId(finalUrl);
  if (!id) throw new ListError('네이버지도 리스트 공유 링크가 아니에요. 리스트의 ⋮ → 공유 → 링크 복사로 받은 주소를 붙여 주세요.');
  const api = `https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/${id}/bookmarks?start=0&limit=5000&sort=lastUseTime`;
  const res = await fetch(api, { headers: { 'user-agent': UA, referer: 'https://map.naver.com/', 'accept-language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(10000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const msg = json?.displayMessage || json?.apiErrorMessage || `HTTP ${res.status}`;
    throw new ListError(`네이버지도 리스트를 읽지 못했어요: ${msg}. 리스트 공개 설정이 '공개'인지 확인해 주세요.`, res.status === 404 ? 404 : 502);
  }
  const rows = json.bookmarkList || json.bookmarks || json.list || json.items || [];
  const folder = json.folder || json.folderInfo || {};
  return {
    provider: 'naver', listName: folder.name || folder.title || '네이버지도 리스트', listUrl: url,
    places: rows.filter((b) => b.available !== false).map((b) => {
      const name = String(b.displayName || b.name || '').trim();
      const sid = b.sid || b.placeId || b.id;
      return {
        name,
        url: b.url && /^https?:/.test(b.url) ? b.url : sid && /^\d+$/.test(String(sid)) ? `https://map.naver.com/p/entry/place/${sid}` : '',
        address: b.address || b.roadAddress || '',
        tags: [b.mcidName, b.category, b.categoryName].filter(Boolean).join(' '),
        note: b.memo || '',
        lng: b.px, lat: b.py, // 네이버는 경도(px)·위도(py)
      };
    }).filter((p) => p.name),
  };
}

// ---------- 구글지도 ----------
function googleListId(url) {
  const id = /\/placelists\/list\/(-?[\w-]+)/.exec(url) || /!2s(-?[\w-]{10,})!/.exec(url) || /[?&]list=(-?[\w-]+)/.exec(url);
  const token = /token%3D([\w-]+)/.exec(url) || /[?&]token=([\w-]+)/.exec(url);
  return { id: id ? id[1] : '', token: token ? token[1] : '' };
}
async function googleList(url) {
  const finalUrl = await resolve(url, (u) => googleListId(decodeURIComponent(u)).id);
  const { id, token } = googleListId(decodeURIComponent(finalUrl));
  if (!id) throw new ListError('구글지도 리스트 공유 링크가 아니에요. 저장됨 → 리스트 → 공유 → 링크 공유 사용으로 받은 주소를 붙여 주세요.');
  const page = `https://www.google.com/maps/placelists/list/${id}` + (token ? `?token=${token}` : '');
  const session = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  // 리스트 id는 !13s(리스트 페이지 주소) 안에 들어가요.
  const pb = `!2e2!3e2!4i500!6m3!1s${session}!15i204459!28e2!13s${encodeURIComponent(page)}!16b1`;
  const api = `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=ko&gl=kr&pb=${pb}`;
  const res = await fetch(api, { headers: { 'user-agent': UA, referer: page, 'accept-language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(10000) });
  let text = await res.text();
  if (text.startsWith(")]}'")) text = text.slice(4);
  let data;
  try { data = JSON.parse(text); } catch { throw new ListError('구글지도 리스트를 읽지 못했어요. 리스트의 링크 공유가 켜져 있는지 확인해 주세요.', 502); }
  const root = data && data[0];
  const raw = (root && root[8]) || [];
  if (!Array.isArray(raw) || !raw.length) throw new ListError('리스트에 장소가 없거나 비공개예요. 구글지도에서 리스트 링크 공유를 켜 주세요.', 404);
  return {
    provider: 'google', listName: (root && root[4]) || '구글지도 리스트', listUrl: url,
    places: raw.map((p) => {
      const info = (p && p[1]) || [];
      const name = String((p && p[2]) || '').trim();
      const placeId = info[7];
      const q = encodeURIComponent([name, info[4]].filter(Boolean).join(' '));
      return {
        name,
        address: info[4] || '',
        url: `https://www.google.com/maps/search/?api=1&query=${q}` + (typeof placeId === 'string' ? `&query_place_id=${placeId}` : ''),
        note: typeof p[3] === 'string' ? p[3] : '',
        tags: '',
        lat: Array.isArray(info[5]) ? info[5][2] : null,
        lng: Array.isArray(info[5]) ? info[5][3] : null,
      };
    }).filter((p) => p.name),
  };
}

export async function importList(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw new ListError('https:// 로 시작하는 리스트 링크를 붙여 주세요.'); }
  const provider = detectProvider(u.href);
  if (provider === 'naver') return naverList(u.href);
  if (provider === 'google') return googleList(u.href);
  throw new ListError('네이버지도나 구글지도의 리스트 공유 링크만 읽을 수 있어요.');
}
