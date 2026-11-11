// 공개 설정만 넣는 파일이에요. API 키(serviceKey)는 절대 여기에 넣지 마세요.
// 주소를 보고 자동으로 골라요.
//  - PC·같은 Wi‑Fi(localhost, 192.168.x.x 등): npm start 로컬 서버의 /api 사용
//  - 배포 사이트(GitHub Pages 등): 인기 장소는 매일 미리 만든 data/ 파일, 리스트 읽기는 Supabase 함수
(function () {
  // 로그인(Supabase): 공개용 주소와 anon(publishable) 키는 브라우저에 넣도록 만든 값이라 넣어도 안전해요.
  // 데이터는 표의 행 보안(RLS)으로 각자 자기 것만 읽고 쓸 수 있어요. service_role 키는 절대 넣지 마세요.
  const auth = { supabaseUrl: 'https://futemwtqmnmaobogpcfz.supabase.co', supabaseAnonKey: 'sb_publishable_MVvEh0FK8kNKFnpthT0tig_O3YYHaPR' };
  // 주소 끝에 ?site 를 붙이면 PC에서도 배포 사이트처럼 동작해요(배포 전 확인용).
  const local = (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname) || location.hostname.endsWith('.local')) &&
    !/[?&]site\b/.test(location.search);
  window.WEEKEND_CONFIG = local
    ? { apiBase: 'api', ...auth }
    : {
      ...auth,
      apiBase: '',
      dataBase: 'data',
      // Supabase import-list 함수 (공개 주소라 넣어도 안전)
      importListUrl: 'https://futemwtqmnmaobogpcfz.supabase.co/functions/v1/import-list',
    };
})();
