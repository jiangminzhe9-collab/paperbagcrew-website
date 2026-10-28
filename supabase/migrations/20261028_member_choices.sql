alter table public.wallpapers add column if not exists gallery_id integer unique;
alter table public.wallpapers add column if not exists collection text;
create table public.wallpaper_selections (
 user_id uuid not null references auth.users(id) on delete cascade,
 wallpaper_id uuid not null references public.wallpapers(id) on delete restrict,
 slot smallint not null check (slot between 1 and 6),
 created_at timestamptz not null default now(),
 primary key (user_id, wallpaper_id),
 unique (user_id, slot)
);
create index wallpaper_selections_wallpaper_idx on public.wallpaper_selections(wallpaper_id);
alter table public.wallpaper_selections enable row level security;
revoke all on public.wallpaper_selections from public, anon, authenticated;
grant select, insert on public.wallpaper_selections to authenticated;
create policy members_read_own_choices on public.wallpaper_selections for select to authenticated using ((select auth.uid()) = user_id);
create policy members_choose_up_to_six on public.wallpaper_selections for insert to authenticated with check (
(select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous','false') = 'false'
and exists (select 1 from public.wallpapers w where w.id=wallpaper_id and w.published and w.gallery_id is not null)
);
comment on table public.wallpaper_selections is 'Six permanent distinct free choices per account; repeat downloads reuse a choice. Slots and unique constraints enforce concurrent limits.';

