-- 주말에 어디가지? 로그인 동기화용 표: 사용자마다 한 줄(즐겨찾기·제외 목록·리스트·설정을 JSON 하나로)
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 Run 하면 돼요. 여러 번 실행해도 괜찮아요.
create table if not exists public.weekend_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 행 보안: 로그인한 사람은 자기 줄만 읽고 쓸 수 있어요.
alter table public.weekend_data enable row level security;

drop policy if exists "weekend_data own select" on public.weekend_data;
drop policy if exists "weekend_data own insert" on public.weekend_data;
drop policy if exists "weekend_data own update" on public.weekend_data;
drop policy if exists "weekend_data own delete" on public.weekend_data;
create policy "weekend_data own select" on public.weekend_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "weekend_data own insert" on public.weekend_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "weekend_data own update" on public.weekend_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "weekend_data own delete" on public.weekend_data for delete to authenticated using ((select auth.uid()) = user_id);
