begin;
select set_config('test.choice_user',gen_random_uuid()::text,true);
insert into auth.users(id) values (current_setting('test.choice_user')::uuid);
with numbered as (select id, row_number() over(order by id) n from public.wallpapers)
update public.wallpapers w set gallery_id= -numbered.n from numbered where w.id=numbered.id;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('test.choice_user'),'role','authenticated','is_anonymous',false)::text,true);
set local role authenticated;
do $$
declare w record; n integer:=0; first_id uuid;
begin
 for w in select id from public.wallpapers order by id loop
  n:=n+1;
  insert into public.wallpaper_selections(user_id,wallpaper_id,slot) values(auth.uid(),w.id,n);
  if n=1 then first_id:=w.id; end if;
 end loop;
 if n<>6 then raise exception 'Expected six existing artworks'; end if;
 begin
  insert into public.wallpaper_selections(user_id,wallpaper_id,slot) values(auth.uid(),first_id,7);
  raise exception 'Seventh choice allowed';
 exception when check_violation then null; end;
 begin
  insert into public.wallpaper_selections(user_id,wallpaper_id,slot) values(auth.uid(),first_id,1);
  raise exception 'Duplicate choice allowed';
 exception when unique_violation then null; end;
 begin
  insert into public.wallpaper_selections(user_id,wallpaper_id,slot) values(gen_random_uuid(),first_id,1);
  raise exception 'Cross-account insert allowed';
 exception when insufficient_privilege then null; end;
 if has_table_privilege('authenticated','public.wallpaper_selections','UPDATE') or has_table_privilege('authenticated','public.wallpaper_selections','DELETE') then raise exception 'Choices can be rotated'; end if;
 if (select count(*) from public.wallpaper_selections)<>6 then raise exception 'Own choices missing'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 if (select count(*) from public.wallpaper_selections)<>0 then raise exception 'Cross-account read exposed'; end if;
end $$;
select 'PASS: six slots, seventh rejected, duplicate rejected, cross-user read/insert blocked, no update/delete' as test;
rollback;
