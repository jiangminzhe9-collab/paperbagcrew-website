-- FREE DAILY + PRIVATE HISTORY ONLY. No payment events, paid reservations or provider RPCs.
begin;
create table public.arcana_catalog (
 market text not null check(market in ('tw','global')),
 sku text not null check(sku in ('daily','arcana_3','arcana_5')),
 currency text not null check(currency in ('TWD','USD')),
 amount_minor integer,
 provider text check(provider is null),
 enabled boolean not null,
 primary key(market,sku),
 check((sku='daily' and amount_minor=0 and enabled) or (sku<>'daily' and amount_minor is null and not enabled))
);
insert into public.arcana_catalog values
 ('tw','daily','TWD',0,null,true),('global','daily','USD',0,null,true),
 ('tw','arcana_3','TWD',null,null,false),('tw','arcana_5','TWD',null,null,false),
 ('global','arcana_3','USD',null,null,false),('global','arcana_5','USD',null,null,false);
alter table public.arcana_catalog enable row level security;
revoke all on public.arcana_catalog from public,anon,authenticated,service_role;
grant select on public.arcana_catalog to service_role;
-- Compatibility name for free history only; constraints prohibit a paid product.
create table public.arcana_orders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 sku text not null default 'daily' check(sku='daily'),
 amount_minor integer not null default 0 check(amount_minor=0),
 market text not null check(market in ('tw','global')),
 currency text not null check(currency in ('TWD','USD')),
 environment text not null default 'internal' check(environment='internal'),
 -- Existing renderer uses paid as an internal ready-to-render state; no payment exists.
 status text not null default 'paid' check(status='paid'),
 question jsonb not null check(jsonb_typeof(question)='object' and octet_length(question::text)<=8192),
 draw_seed uuid not null default gen_random_uuid(),
 daily_day date not null,
 result jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,daily_day),
 check((market='tw' and currency='TWD') or (market='global' and currency='USD'))
);
create index arcana_orders_user_created on public.arcana_orders(user_id,created_at desc);
alter table public.arcana_orders enable row level security;
revoke all on public.arcana_orders from public,anon,authenticated,service_role;
grant select,insert,update on public.arcana_orders to service_role;
grant select(id,user_id,sku,amount_minor,currency,market,environment,status,question,daily_day,result,created_at,updated_at) on public.arcana_orders to authenticated;
create policy arcana_owner_read on public.arcana_orders for select to authenticated using (
 user_id=(select auth.uid()) and coalesce((select auth.jwt())->>'is_anonymous','false')='false'
);
create function public.arcana_validate_result(p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_result is null or jsonb_typeof(p_result)<>'object' or jsonb_typeof(p_result->'cards') is distinct from 'array'
 or jsonb_typeof(p_result->'reading') is distinct from 'object'
 or coalesce(length(p_result->>'reading_version'),0) not between 1 and 128 or octet_length(p_result::text)>262144 then raise exception 'invalid result'; end if;
 if jsonb_array_length(p_result->'cards')<>1 then raise exception 'daily requires exactly one card'; end if;
 if exists(select 1 from jsonb_array_elements(p_result->'cards') c where jsonb_typeof(c) is distinct from 'object'
 or jsonb_typeof(c->'id') is distinct from 'number' or coalesce(c->>'id','') !~ '^(0|[1-6]?[0-9]|7[0-7])$'
 or jsonb_typeof(c->'reversed') is distinct from 'boolean') then raise exception 'invalid card'; end if;
end $$;
create function public.arcana_order_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'immutable history'; end if;
 if TG_OP='INSERT' then
  if new.result is not null or new.daily_day<>(statement_timestamp() at time zone 'Asia/Taipei')::date then raise exception 'invalid daily reservation'; end if;
  return new;
 end if;
 if row(new.id,new.user_id,new.sku,new.amount_minor,new.currency,new.market,new.environment,new.status,new.question,new.draw_seed,new.daily_day,new.created_at)
 is distinct from row(old.id,old.user_id,old.sku,old.amount_minor,old.currency,old.market,old.environment,old.status,old.question,old.draw_seed,old.daily_day,old.created_at) then raise exception 'immutable reservation'; end if;
 if old.result is not null and new.result is distinct from old.result then raise exception 'immutable result'; end if;
 if new.result is not null and old.result is null then perform public.arcana_validate_result(new.result); end if;
 new.updated_at=now(); return new;
end $$;
create trigger arcana_order_guard before insert or update or delete on public.arcana_orders for each row execute function public.arcana_order_guard();
create function public.reserve_arcana_daily(p_user uuid,p_question jsonb,p_market text default 'tw')
returns public.arcana_orders language plpgsql security invoker set search_path='' as $$
declare r public.arcana_orders; d date=(statement_timestamp() at time zone 'Asia/Taipei')::date;
begin
 if p_user is null or p_market is null or p_market not in ('tw','global') or p_question is null or jsonb_typeof(p_question)<>'object' then raise exception 'invalid daily request'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('arcana:daily:'||p_user::text||':'||d::text,0));
 select * into r from public.arcana_orders where user_id=p_user and daily_day=d;
 if found then return r; end if;
 insert into public.arcana_orders(user_id,market,currency,question,daily_day)
 values(p_user,p_market,case p_market when 'tw' then 'TWD' else 'USD' end,p_question,d) returning * into r;
 return r;
end $$;
create function public.fulfill_arcana_order(p_order uuid,p_result jsonb)
returns public.arcana_orders language plpgsql security invoker set search_path='' as $$
declare r public.arcana_orders;
begin
 select * into r from public.arcana_orders where id=p_order for update;
 if not found then raise exception 'unknown daily reading'; end if;
 if r.result is not null then return r; end if;
 perform public.arcana_validate_result(p_result);
 update public.arcana_orders set result=p_result where id=p_order returning * into r;
 return r;
end $$;
revoke all on function public.arcana_validate_result(jsonb),public.arcana_order_guard(),public.reserve_arcana_daily(uuid,jsonb,text),public.fulfill_arcana_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.arcana_validate_result(jsonb),public.reserve_arcana_daily(uuid,jsonb,text),public.fulfill_arcana_order(uuid,jsonb) to service_role;
commit;
