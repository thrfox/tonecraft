-- Tonecraft score library. Apply once to the dedicated Tonecraft Supabase project.
-- The admin table starts empty: add the owner's auth.users ID after creating the login.

create table if not exists public.score_admins (
  id uuid primary key references auth.users(id) on delete cascade
);
alter table public.score_admins enable row level security;
revoke all on public.score_admins from anon, authenticated;
grant select on public.score_admins to authenticated;
create policy "score admins can see their own role"
  on public.score_admins for select to authenticated
  using (id = (select auth.uid()));

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  composer text check (composer is null or char_length(composer) <= 120),
  storage_path text not null unique,
  file_type text not null check (file_type in ('pdf', 'png', 'jpg', 'jpeg', 'webp', 'musicxml', 'xml')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists scores_created_at_idx on public.scores (created_at desc);
alter table public.scores enable row level security;
revoke all on public.scores from anon, authenticated;
grant select on public.scores to anon, authenticated;
grant insert, delete on public.scores to authenticated;
create policy "anyone can read scores"
  on public.scores for select to anon, authenticated using (true);
create policy "only score admins can add scores"
  on public.scores for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.score_admins where id = (select auth.uid()))
  );
create policy "only score admins can remove scores"
  on public.scores for delete to authenticated
  using (exists (select 1 from public.score_admins where id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'scores', 'scores', true, 15728640,
  array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
    'application/xml', 'application/vnd.recordare.musicxml+xml'
  ]
)
on conflict (id) do nothing;

create policy "score admins can inspect score files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'scores'
    and exists (select 1 from public.score_admins where id = (select auth.uid()))
  );
create policy "only score admins can upload score files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'scores'
    and exists (select 1 from public.score_admins where id = (select auth.uid()))
  );
create policy "only score admins can remove score files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'scores'
    and exists (select 1 from public.score_admins where id = (select auth.uid()))
  );
