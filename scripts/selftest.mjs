// node scripts/selftest.mjs — 가져오기·중복·저장 유지·필터·빈 후보 확인
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../dist/core.js');
const fx = (f) => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
let n = 0; const ok = (msg) => console.log(`✔ ${++n}. ${msg}`);

// 1. 분류
assert.equal(C.infer('국립어린이과학관'), '과학관');
assert.equal(C.infer('난지캠핑장'), '캠핑장');
assert.equal(C.infer('남서울CC'), '골프·레저');
assert.equal(C.infer('키즈카페 점프'), '체험·놀이');
assert.equal(C.infer('을지면옥'), '맛집·카페');
assert.equal(C.infer('경복궁'), '여행지');
assert.equal(C.infer('해운대해수욕장'), '여행지');
assert.equal(C.infer('서울빛초롱축제'), '축제·행사');
assert.equal(C.infer('OO가든', '', '음식점>한식'), '맛집·카페');
assert.equal(C.groupOf('과학관'), 'kids');
assert.equal(C.groupOf('맛집·카페'), 'food');
assert.equal(C.infer('가평 숲속 펜션'), '숙소·펜션');
assert.equal(C.infer('서울어린이대공원'), '자연·공원');
ok('카테고리 자동 분류 + 큰 분류(아이랑/캠핑장/여행지/음식점/숙소/기타), 네이버 업종명 활용');

// 2. Takeout CSV: 추가 / 중복 / 오류 / 경고
const csv = C.fromCsv(fx('want-to-go.csv'), 'want-to-go');
let r = C.mergeImport([], csv);
assert.deepEqual(r.report.added, ['국립과천과학관', '난지캠핑장', '남서울CC', '을지면옥', '가평 숲속 펜션', '수원 화성행궁']);
assert.deepEqual(r.report.duplicates, ['국립과천과학관']);
assert.equal(r.report.errors.length, 1);
assert.match(r.report.errors[0].error, /이름이 비어/);
assert.equal(r.report.warnings.length, 1);
assert.equal(r.next.find((p) => p.name === '국립과천과학관').note, '아이가 좋아함, 또 가기');
ok('CSV: 6곳 추가, 파일 안 중복 1곳·이름 없는 행 1건 건너뜀, 잘못된 링크 경고, 따옴표 속 쉼표 유지');

// 3. 같은 파일 다시 가져오기 → 전부 중복
const again = C.mergeImport(r.next, C.fromCsv(fx('want-to-go.csv')));
assert.equal(again.report.added.length, 0);
assert.equal(again.report.duplicates.length, 7);
ok('같은 CSV 재가져오기: 0곳 추가, 7곳 중복 처리');

// 4. GeoJSON (새/옛 형식) + 지역 추출
const geo = C.mergeImport(r.next, C.fromGeoJson(fx('saved-places.json'), 'Saved Places'));
assert.deepEqual(geo.report.added, ['경기도어린이박물관', '하늘공원']);
assert.equal(geo.next.find((p) => p.name === '경기도어린이박물관').region, '경기 용인');
assert.equal(geo.next.find((p) => p.name === '하늘공원').region, '서울 마포구');
assert.equal(geo.report.errors.length, 1);
ok('Saved Places.json: 2곳 추가, 주소에서 지역 추출, 이름 없는 항목 오류 처리');

// 5. 공유 문구 붙여넣기
const share = C.fromShareText(`[네이버 지도]
국립과천과학관
경기 과천시 상하벌로 110
https://naver.me/5abcd
서울숲 https://naver.me/xyz12
https://www.google.com/maps/place/%EC%84%9C%EC%9A%B8%EC%83%81%EC%83%81%EB%82%98%EB%9D%BC/@37.5
https://maps.app.goo.gl/onlylink`);
assert.equal(share.length, 4);
assert.deepEqual(share.slice(0, 3).map((x) => x.name), ['국립과천과학관', '서울숲', '서울상상나라']);
assert.equal(share[0].region, '경기 과천');
assert.equal(share[1].region, '', '서울숲은 지역 이름이 아님');
assert.equal(C.regionFromAddress('대한민국 서울특별시 종로구 창경궁로 215'), '서울 종로구');
assert.equal(C.regionFromAddress('제주특별자치도 서귀포시 성산읍'), '제주 서귀포');
assert.equal(C.regionFromAddress('Gyeonggi-do, Gwacheon-si'), '경기');
assert.ok(share[3].error);
ok('공유 문구: 여러 장소를 나눠 인식, 주소→지역, 이름 없는 링크는 오류로 안내');

// 6. 저장 유지(새로고침) + v1 데이터 이전
const s = mem();
s.setItem(C.LEGACY_KEY, JSON.stringify([{ id: 'seed5', name: '서울숲', region: '서울 성동구', category: '자연·공원', note: '' }, { id: 'x', name: '우리동네 캠핑장', url: 'https://naver.me/a', category: '캠핑장' }]));
let L = C.loadPlaces(s);
assert.equal(L.migrated, true);
assert.equal(L.places.length, 2);
assert.equal(L.places[0].env, '야외');
C.savePlaces(s, [...L.places, C.makePlace({ name: '국립어린이과학관' })]);
L = C.loadPlaces(s);
assert.equal(L.migrated, false);
assert.equal(L.places.length, 3);
assert.ok(s.getItem(C.LEGACY_KEY), 'v1 원본은 지우지 않음');
ok('v1(weekend-places-v1) 데이터 읽기·이전, 저장 후 다시 읽어도 유지');

// 7. 새로운 장소에서 저장한 곳 제외 + 기본 추천 8곳
const pool0 = C.discoverPool([], C.SEED, []);
assert.equal(pool0.length, 8);
const pool1 = C.discoverPool([], C.SEED, L.places);
assert.equal(pool1.length, 6);
assert.ok(!pool1.some((p) => ['서울숲', '국립어린이과학관'].includes(p.name)));
ok('새로운 장소: 기본 추천 8곳, 이미 저장한 서울숲·국립어린이과학관은 제외');

// 8. 필터: 나들이 외 제외/포함, 실내·야외, 지역, 빈 후보
const all = geo.next;
const base = { region: 'all' };
assert.ok(!C.filterPlaces(all, { ...base, outingOnly: true }).some((p) => ['남서울CC', '을지면옥', '가평 숲속 펜션'].includes(p.name)));
assert.ok(C.filterPlaces(all, base).some((p) => p.name === '남서울CC'));
assert.deepEqual(C.filterPlaces(all, { ...base, group: 'food' }).map((p) => p.name), ['을지면옥']);
assert.deepEqual(C.filterPlaces(all, { ...base, group: 'camp' }).map((p) => p.name), ['난지캠핑장']);
assert.deepEqual(C.filterPlaces(C.SEED, { region: 'sg', env: '실내', category: '' }).map((p) => p.category).filter((c) => !['과학관', '박물관', '체험·놀이'].includes(c)), []);
assert.equal(C.filterPlaces(C.SEED, { region: 'sg', category: '캠핑장' }).length, 2);
assert.equal(C.filterPlaces(C.SEED, { region: 'jeju' }).length, 0);
assert.equal(C.filterPlaces(C.SEED, { region: 'sg', category: '캠핑장', env: '실내' }).length, 0);
assert.equal(C.pickOne([], null), null);
ok('필터: 나들이 후보에서 골프·음식점·숙소 제외, 큰 분류별 보기, 실내·야외, 지역, 후보 없음 → pick=null');

// 9. 한 곳 골라줘는 현재 후보에서만, 직전 결과 피하기
const camps = C.filterPlaces(C.SEED, { region: 'sg', category: '캠핑장' });
for (let i = 0; i < 20; i++) assert.equal(C.pickOne(camps, null).category, '캠핑장');
assert.notEqual(C.pickOne(camps, camps[0].id).id, camps[0].id);
ok('한 곳 골라줘: 조건에 맞는 후보에서만, 다시 뽑으면 다른 곳');

// 10. 가져오기 미리보기 + 백업
const prev = C.previewImport(r.next, [{ name: '서울숲', url: '' }, { name: '새 캠핑장', url: 'https://naver.me/n1' }, { name: '새 캠핑장', url: 'https://naver.me/n1' }, { error: 'x' }, { name: '하늘공원', address: '서울특별시 마포구 하늘공원로 84' }]);
assert.deepEqual(prev.map((x) => x.status), ['new', 'new', 'dup', 'error', 'new']);
assert.equal(prev[4].place.region, '서울 마포구');
const back = C.parseBackup(C.exportBackup(geo.next));
assert.equal(C.mergeImport([], back).report.added.length, geo.next.length);
assert.equal(C.mergeImport(geo.next, back).report.added.length, 0);
assert.throws(() => C.parseBackup('{"x":1}'));
ok('가져오기 미리보기(새로/중복/오류), 주소→지역, 백업 내보내기·불러오기(중복 없음)');

// 11. 네이버 리스트 공유 링크가 거쳐 가는 주소들에서 리스트 id 찾기 (실제 naver.me 링크에서 관찰한 모양)
const { naverShareId } = await import('../supabase/functions/_shared/lists.js');
const sid = 'be68b8f55f3a474ca4fe88ebb7a50d4b';
assert.equal(naverShareId(`https://map.naver.com/p/favorite/sharedPlace/folder/${sid}`), sid);
assert.equal(naverShareId(`https://m.map.naver.com/appLink.naver?version=2&appTargetPage=bookmark/share&id=${sid}&appSchemeName=nmap&fallbackUrl=https%3A%2F%2Fpages.map.naver.com%2Fsave-pages%2Fweb%2Fdetail-list%2F${sid}%3Fat%3Du`), sid);
assert.equal(naverShareId(`https://pages.map.naver.com/save-pages/web/detail-list/${sid}?at=u`), sid);
assert.equal(naverShareId('https://map.naver.com/p/entry/place/1278290240'), '');
assert.equal(C.infer('이지캠프 양주'), '캠핑장');
assert.equal(C.infer('아쿠아플라넷 일산'), '체험·놀이');
ok('네이버 리스트 링크(리다이렉트 3단계)에서 id 찾기, 장소 하나 링크는 구분');

console.log(`\n모든 확인 통과 (${n}개)`);
