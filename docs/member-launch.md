# Member downloads launch

The database setup is applied to project yliacgixfhjhgjemvbpg. This branch is a pre-launch implementation, not a verified public registration service.

Before merging:
- Confirm custom SMTP is configured in Supabase Authentication > Email > SMTP and test delivery to an external address. The default sender is restricted to project team members. Never disable email verification as a workaround.
- Set Site URL to https://paperbagcrew.com and allow https://paperbagcrew.com/members/ as a redirect URL.
- Upload approved original wallpapers to the private member-wallpapers bucket through Storage or a trusted admin client. Do not commit member-only originals to this public repository.
- Add matching object_path and title to public.wallpapers; set published=true only after checking each file. The catalogue is currently empty.
- Test sign-in from email in the same browser, reload/session restoration, nickname save, logout, and download on desktop and mobile. Test expired links and two different users.
- Link /members/ from the home page once these checks pass. Replace the retired creator navigation entry at launch.

The page uses pinned supabase-js 2.118.0, a publishable key, persistent PKCE sessions and 60-second signed download links. Email lives in Supabase Auth; private profile rows store an optional nickname. Shipping addresses are not collected. Profile creation is lazy on first save. Unpublished files and anonymous auth accounts cannot download. Signed URLs remain usable until expiry after logout.

Verified backend: security advisor returned no lints; transactional tests confirmed own-profile read/update and cross-user write denial. Test fixtures were rolled back. Browser end-to-end email sign-in has not been verified.

## Applied schema reference

This is an audit copy, not a new migration to run twice.

```sql

create table public.member_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check (char_length(display_name)<=80),
 marketing_opt_in boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.member_profiles enable row level security;
revoke all on public.member_profiles from anon, authenticated;
grant select, insert on public.member_profiles to authenticated;
grant update(display_name, marketing_opt_in) on public.member_profiles to authenticated;
create policy member_read_own on public.member_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy member_create_own on public.member_profiles for insert to authenticated with check ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false');
create policy member_update_own on public.member_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table public.wallpapers (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(title) between 1 and 160),
 object_path text not null unique,
 preview_url text,
 published boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.wallpapers enable row level security;
revoke all on public.wallpapers from anon, authenticated;
grant select on public.wallpapers to authenticated;
create policy members_read_published_wallpapers on public.wallpapers for select to authenticated using (published and coalesce((select auth.jwt())->>'is_anonymous','false')='false');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('member-wallpapers','member-wallpapers',false,20971520,array['image/png','image/jpeg','image/webp','application/zip']);
create policy members_download_published_wallpapers on storage.objects for select to authenticated using (
 bucket_id='member-wallpapers'
 and coalesce((select auth.jwt())->>'is_anonymous','false')='false'
 and exists(select 1 from public.wallpapers w where w.object_path=name and w.published)
);

```
