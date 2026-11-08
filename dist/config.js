// 공개 설정만 넣는 파일이에요. API 키(serviceKey)는 절대 여기에 넣지 마세요.
// 주소를 보고 자동으로 골라요.
//  - PC·같은 Wi‑Fi(localhost, 192.168.x.x 등): npm start 로컬 서버의 /api 사용
//  - 배포 사이트(GitHub Pages 등): 인기 장소는 매일 미리 만든 data/ 파일, 리스트 읽기는 Supabase 함수
(function () {
  // 주소 끝에 ?site 를 붙이면 PC에서도 배포 사이트처럼 동작해요(배포 전 확인용).
  const local = (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname) || location.hostname.endsWith('.local')) &&
    !/[?&]site\b/.test(location.search);
  window.WEEKEND_CONFIG = local
    ? { apiBase: 'api' }
    : {
      apiBase: '',
      dataBase: 'data',
      // Supabase에 import-list 함수를 배포한 뒤 프로젝트 주소로 바꿔요 (공개 주소라 넣어도 안전)
      importListUrl: 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/import-list',
    };
})();
