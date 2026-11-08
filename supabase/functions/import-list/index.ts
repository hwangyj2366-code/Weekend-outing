// 주말에 어디가지? — 공개 공유한 네이버지도·구글지도 리스트 읽기 (Supabase Edge Function)
// 배포: supabase functions deploy import-list --no-verify-jwt
// 호출: GET /functions/v1/import-list?url=<리스트 공유 링크>
import { importList } from '../_shared/lists.js';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await importList(new URL(req.url).searchParams.get('url') ?? '');
    return Response.json(body, { headers: cors });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: (e as { status?: number }).status ?? 502, headers: cors });
  }
});
