// 공개 설정만 넣는 파일이에요. API 키(serviceKey)는 절대 여기에 넣지 마세요.
// apiBase: 인기 장소(/discover)와 리스트 읽기(/import-list) 서버 주소
//   - 'api'  : npm start 로컬 서버(같은 Wi‑Fi 휴대폰 포함) — 기본값
//   - 'https://<project-ref>.supabase.co/functions/v1' : Supabase에 배포한 경우
//   - ''     : 서버 없이 기본 추천만
window.WEEKEND_CONFIG = {
  apiBase: 'api',
};
