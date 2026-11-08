// 앱 아이콘 만들기: "이번 주말 뭐 하고 놀까?" — 토·일이 빛나는 달력 위에 꽂힌 지도 핀, 반짝이와 노란 바탕.
// 같은 도형 목록으로 SVG(dist/icon.svg)와 PNG(192·512·180)를 함께 만들어요. 실행: npm run icons
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { PNG } = createRequire(import.meta.url)('pngjs');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const C = {
  bg: '#FFD43B', card: '#FFFFFF', cardShadow: '#F0B91E', header: '#FF5B36', ring: '#1F4FA8',
  cell: '#E8EEF6', sun: '#FF5B36', pin: '#1F4FA8', pinDot: '#FFFFFF', spark: '#FFFFFF',
};

// 달력 칸: 3줄 × 7칸. 마지막 줄의 토·일은 하나의 밝은 띠로 칠하고 그 위에 흰 점 두 개
const cells = [];
for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) {
  const x = 312 + col * 67, y = 500 + row * 82;
  if (row === 2 && col >= 5) cells.push(['circle', C.pinDot, x, y, 13]);
  else cells.push(['circle', C.cell, x, y, 22]);
}
const weekendBand = ['capsule', C.sun, 647, 664, 714, 664, 40];
// 반짝이(+ 모양)
const spark = (x, y, s) => [['capsule', C.spark, x - s, y, x + s, y, s / 3.2], ['capsule', C.spark, x, y - s, x, y + s, s / 3.2]];

// 1024×1024 기준. 위에서부터 차례로 덧칠해요.
// circle [cx, cy, r] · ellipse [cx, cy, rx, ry] · capsule [x1, y1, x2, y2, r] · rrect [x, y, w, h, r] · poly [x1, y1, x2, y2, …]
const SHAPES = [
  ['rrect', C.cardShadow, 236, 282, 560, 560, 72], // 달력 그림자
  ['rrect', C.card, 222, 262, 560, 560, 72], // 달력
  ['rrect', C.header, 222, 262, 560, 170, 72], // 빨간 머리
  ['rrect', C.header, 222, 360, 560, 72, 0], //   (아래 모서리는 각지게)
  ['capsule', C.ring, 372, 220, 372, 312, 24], // 고리
  ['capsule', C.ring, 632, 220, 632, 312, 24],
  weekendBand,
  ...cells,
  // 지도 핀: 위에서 토·일을 콕 찍어요
  ['circle', C.pin, 680, 392, 112],
  ['poly', C.pin, 584, 450, 776, 450, 680, 622],
  ['circle', C.pinDot, 680, 392, 46],
  // 반짝이
  ...spark(860, 210, 54), ...spark(150, 300, 36), ...spark(150, 820, 44),
];

// ---- SVG ----
const svgShape = ([t, fill, ...a]) => t === 'circle' ? `<circle cx="${a[0]}" cy="${a[1]}" r="${a[2]}" fill="${fill}"/>`
  : t === 'ellipse' ? `<ellipse cx="${a[0]}" cy="${a[1]}" rx="${a[2]}" ry="${a[3]}" fill="${fill}"/>`
  : t === 'rrect' ? `<rect x="${a[0]}" y="${a[1]}" width="${a[2]}" height="${a[3]}" rx="${a[4]}" fill="${fill}"/>`
  : t === 'poly' ? `<polygon points="${a.join(' ')}" fill="${fill}"/>`
  : `<line x1="${a[0]}" y1="${a[1]}" x2="${a[2]}" y2="${a[3]}" stroke="${fill}" stroke-width="${a[4] * 2}" stroke-linecap="round"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><clipPath id="c"><rect width="1024" height="1024" rx="224"/></clipPath></defs>` +
  `<g clip-path="url(#c)"><rect width="1024" height="1024" fill="${C.bg}"/>${SHAPES.map(svgShape).join('')}</g></svg>\n`;
writeFileSync(join(out, 'icon.svg'), svg);

// ---- PNG (4×4 샘플링으로 가장자리를 부드럽게) ----
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const inside = ([t, , ...a], x, y) => {
  if (t === 'circle') return (x - a[0]) ** 2 + (y - a[1]) ** 2 <= a[2] ** 2;
  if (t === 'ellipse') return ((x - a[0]) / a[2]) ** 2 + ((y - a[1]) / a[3]) ** 2 <= 1;
  if (t === 'rrect') {
    const [x0, y0, w, h, r] = a;
    if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
    const qx = Math.max(Math.abs(x - (x0 + w / 2)) - (w / 2 - r), 0);
    const qy = Math.max(Math.abs(y - (y0 + h / 2)) - (h / 2 - r), 0);
    return qx * qx + qy * qy <= r * r;
  }
  if (t === 'poly') {
    let hit = false;
    for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
      const [xi, yi, xj, yj] = [a[i], a[i + 1], a[j], a[j + 1]];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }
  const [x1, y1, x2, y2, r] = a; const dx = x2 - x1, dy = y2 - y1;
  const k = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
  return (x - x1 - k * dx) ** 2 + (y - y1 - k * dy) ** 2 <= r * r;
};
const colorAt = (x, y) => { let c = C.bg; for (const s of SHAPES) if (inside(s, x, y)) c = s[1]; return rgb(c); };
// 홈 화면 아이콘은 OS가 모양(둥근 사각형·원)을 잘라 주므로 PNG는 꽉 채워요(달력·핀은 가운데 80% 안에 있어 maskable로도 안전).
function png(size, file) {
  const img = new PNG({ width: size, height: size });
  const s = 1024 / size, N = 4;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const acc = [0, 0, 0];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = colorAt((px + (i + 0.5) / N) * s, (py + (j + 0.5) / N) * s);
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const o = (py * size + px) * 4;
    img.data[o] = acc[0] / (N * N); img.data[o + 1] = acc[1] / (N * N); img.data[o + 2] = acc[2] / (N * N); img.data[o + 3] = 255;
  }
  writeFileSync(join(out, file), PNG.sync.write(img));
}
png(512, 'icon-512.png');
png(192, 'icon-192.png');
png(180, 'apple-touch-icon.png');
console.log('dist/icon.svg, icon-512.png, icon-192.png, apple-touch-icon.png 를 만들었어요.');
