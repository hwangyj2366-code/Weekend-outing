// 주말에 어디가지? — 인기 나들이 장소 (Supabase Edge Function)
// 비밀값: supabase secrets set TOUR_API_KEY=<공공데이터포털 일반 인증키(Decoding)>
// 배포:   supabase functions deploy discover --no-verify-jwt
// 호출:   GET /functions/v1/discover?region=sg
import { discover } from '../_shared/tour.js';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const region = new URL(req.url).searchParams.get('region') ?? 'sg';
  try {
    const body = await discover(Deno.env.get('TOUR_API_KEY') ?? '', region);
    return Response.json(body, { headers: { ...cors, 'cache-control': 'public, max-age=3600' } });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: (e as { status?: number }).status ?? 502, headers: cors });
  }
});
