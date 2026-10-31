-- LOCAL REVIEW DRAFT. Not applied; create a CLI migration only after authorization.
-- Separate from wallpaper commerce. amount_minor: whole TWD / USD cents; never browser prices.
begin;
create table public.arcana_catalog (
 market text not null check(market in ('tw','global')),
 sku text not null check(sku in ('daily','arcana_3','arcana_5')),
 currency text not null check(currency in ('TWD','USD')),
 amount_minor integer check(amount_minor>=0),
 provider text check(provider is null or provider='paypal'),
 enabled boolean not null default false,
 primary key(market,sku),
 unique(market,sku,currency,amount_minor),
 check((market='tw' and currency='TWD') or (market='global' and currency='USD')),
 check(not enabled or amount_minor is not null)
);
-- USD paid prices intentionally unavailable pending explicit confirmation.
insert into public.arcana_catalog values
 ('tw','daily','TWD',0,null,true),('tw','arcana_3','TWD',299,null,true),('tw','arcana_5','TWD',499,null,true),
 ('global','daily','USD',0,null,true),('global','arcana_3','USD',null,'paypal',false),('global','arcana_5','USD',null,'paypal',false);
alter table public.arcana_catalog enable row level security;
revoke all on public.arcana_catalog from public,anon,authenticated,service_role;
grant select on public.arcana_catalog to service_role;
create table public.arcana_orders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 sku text not null check(sku in ('daily','arcana_3','arcana_5')),
 amount_minor integer not null,
 currency text not null check(currency in ('TWD','USD')),
 market text not null check(market in ('tw','global')),
 environment text not null check(environment in ('sandbox','live','internal')),
 request_key text not null check(length(request_key) between 1 and 128),
 question jsonb not null check(jsonb_typeof(question)='object' and octet_length(question::text)<=8192),
 draw_seed uuid not null default gen_random_uuid(),
 daily_day date,
 status text not null default 'creating' check(status in ('creating','created','approved','pending','paid','declined','voided','refunded','reversed')),
 provider text check(provider is null or provider='paypal'),
 provider_order_id text unique,
 provider_capture_id text unique,
 merchant_id text,
 result jsonb check(result is null or jsonb_typeof(result)='object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(market,sku,currency,amount_minor) references public.arcana_catalog(market,sku,currency,amount_minor),
 unique(user_id,request_key),
 unique(user_id,daily_day),
 check((sku='daily' and amount_minor=0 and daily_day is not null and environment='internal' and status='paid' and provider_order_id is null and provider_capture_id is null)
    or (sku='arcana_3' and amount_minor>0 and daily_day is null and environment in ('sandbox','live'))
    or (sku='arcana_5' and amount_minor>0 and daily_day is null and environment in ('sandbox','live')))
);
create index arcana_orders_user_created on public.arcana_orders(user_id,created_at desc);
create table public.arcana_payment_events (
 event_id text primary key check(length(event_id) between 1 and 255),
 provider text not null default 'paypal' check(provider='paypal'),
 order_id uuid not null references public.arcana_orders(id),
 payload jsonb not null,
 received_at timestamptz not null default now()
);
create index arcana_events_order on public.arcana_payment_events(order_id);
alter table public.arcana_orders enable row level security;
alter table public.arcana_payment_events enable row level security;
revoke all on public.arcana_orders,public.arcana_payment_events from public,anon,authenticated,service_role;
grant select(id,user_id,sku,amount_minor,currency,market,environment,request_key,question,daily_day,status,result,created_at,updated_at) on public.arcana_orders to authenticated;
-- No client SELECT on draw_seed or provider bindings: do not preview unpaid draws.
grant select,insert,update on public.arcana_orders to service_role;
grant select,insert on public.arcana_payment_events to service_role;
create policy arcana_owner_read on public.arcana_orders for select to authenticated using (
 user_id=(select auth.uid())
 and coalesce((select auth.jwt())->>'is_anonymous','false')='false'
 and status not in ('refunded','reversed','voided')
);
-- No client INSERT/UPDATE/DELETE policy or grant. Revocation hides the whole row,
-- including the immutable result; a backend may expose a sanitized status history.
create function public.arcana_validate_result(p_sku text,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 n=case p_sku when 'daily' then 1 when 'arcana_3' then 3 when 'arcana_5' then 5 end;
 if p_result is null or jsonb_typeof(p_result)<>'object'
   or jsonb_typeof(p_result->'cards') is distinct from 'array'
   or jsonb_typeof(p_result->'reading') is distinct from 'object'
   or coalesce(length(p_result->>'reading_version'),0) not between 1 and 128
   or octet_length(p_result::text)>262144 then raise exception 'invalid result snapshot'; end if;
 if jsonb_array_length(p_result->'cards')<>n then raise exception 'wrong card count'; end if;
 if exists(select 1 from jsonb_array_elements(p_result->'cards') c
   where jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'id') is distinct from 'number'
   or coalesce(c->>'id','') !~ '^(0|[1-6]?[0-9]|7[0-7])$'
   or jsonb_typeof(c->'reversed') is distinct from 'boolean')
 then raise exception 'invalid card'; end if;
 if (select count(distinct c->>'id') from jsonb_array_elements(p_result->'cards') c)<>n then raise exception 'duplicate card'; end if;
end $$;
revoke all on function public.arcana_validate_result(text,jsonb) from public,anon,authenticated;
grant execute on function public.arcana_validate_result(text,jsonb) to service_role;

create function public.arcana_order_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then
  if new.result is not null or new.provider is not null or new.provider_order_id is not null or new.provider_capture_id is not null or new.merchant_id is not null then raise exception 'reservation must be unfulfilled/unbound'; end if;
  if (new.sku='daily' and new.status<>'paid') or (new.sku<>'daily' and new.status<>'creating') then raise exception 'invalid initial status'; end if;
  return new;
 end if;
 if new.provider is not null and (new.provider<>'paypal' or new.market<>'global') then raise exception 'provider not configured for market'; end if;
 if old.provider is not null and new.provider is distinct from old.provider then raise exception 'provider immutable'; end if;
 if new.sku<>'daily' and new.status in ('paid','refunded','reversed') and (new.provider is null or new.provider_order_id is null or new.provider_capture_id is null or new.merchant_id is null) then raise exception 'payment binding required'; end if;
 if new.result is not null and old.result is null then
  perform public.arcana_validate_result(new.sku,new.result);
 end if;
 if TG_OP='DELETE' then raise exception 'arcana snapshots cannot be deleted'; end if;
 if row(new.id,new.user_id,new.sku,new.amount_minor,new.currency,new.market,new.environment,new.request_key,new.question,new.draw_seed,new.daily_day,new.created_at)
    is distinct from row(old.id,old.user_id,old.sku,old.amount_minor,old.currency,old.market,old.environment,old.request_key,old.question,old.draw_seed,old.daily_day,old.created_at)
 then raise exception 'arcana reservation is immutable'; end if;
 if old.result is not null and new.result is distinct from old.result then raise exception 'arcana result is immutable'; end if;
 if old.provider_order_id is not null and new.provider_order_id is distinct from old.provider_order_id then raise exception 'provider order immutable'; end if;
 if old.provider_capture_id is not null and new.provider_capture_id is distinct from old.provider_capture_id then raise exception 'capture immutable'; end if;
 if old.merchant_id is not null and new.merchant_id is distinct from old.merchant_id then raise exception 'merchant immutable'; end if;
 if old.status in ('refunded','reversed') and new.status not in ('refunded','reversed') then raise exception 'revocation terminal'; end if;
 if old.status='reversed' and new.status<>'reversed' then raise exception 'reversal terminal'; end if;
 if old.status in ('declined','voided') and new.status not in (old.status,'refunded','reversed') then raise exception 'closed order'; end if;
 if old.status='paid' and new.status not in ('paid','refunded','reversed') then raise exception 'paid cannot regress'; end if;
 if new.result is not null and old.result is null and new.status<>'paid' then raise exception 'payment required'; end if;
 new.updated_at=now();
 return new;
end $$;
create trigger arcana_order_guard before insert or update or delete on public.arcana_orders for each row execute function public.arcana_order_guard();

create function public.reserve_arcana_order(p_user uuid,p_request_key text,p_sku text,p_environment text,p_question jsonb,p_market text default 'tw')
returns public.arcana_orders language plpgsql security invoker set search_path='' as $$
declare r public.arcana_orders; product public.arcana_catalog;
begin
 if p_user is null or p_request_key is null or length(p_request_key) not between 1 and 128 or p_request_key like 'daily:%'
   or p_sku is null or p_sku not in ('arcana_3','arcana_5') or p_environment is null or p_environment not in ('sandbox','live')
   or p_market is null or p_market not in ('tw','global')
   or p_question is null or jsonb_typeof(p_question)<>'object' then raise exception 'invalid reservation'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('arcana:open:'||p_user::text||':'||p_environment,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('arcana:'||p_user::text||':'||p_request_key,0));
 select * into r from public.arcana_orders where user_id=p_user and request_key=p_request_key;
 if found then
  if r.sku<>p_sku or r.environment<>p_environment or r.question<>p_question or r.market<>p_market then raise exception 'idempotency conflict'; end if;
  return r;
 end if;
 if (select count(*) from public.arcana_orders where user_id=p_user and environment=p_environment and sku<>'daily' and status in ('creating','created','approved','pending'))>=5 then raise exception 'arcana_pending_limit'; end if;
 select * into product from public.arcana_catalog where market=p_market and sku=p_sku and enabled and amount_minor is not null;
 if not found then raise exception 'catalog unavailable'; end if;
 insert into public.arcana_orders(user_id,sku,amount_minor,currency,market,environment,request_key,question)
 values(p_user,p_sku,product.amount_minor,product.currency,p_market,p_environment,p_request_key,p_question) returning * into r;
 return r;
end $$;

create function public.reserve_arcana_daily(p_user uuid,p_question jsonb,p_market text default 'tw')
returns public.arcana_orders language plpgsql security invoker set search_path='' as $$
declare r public.arcana_orders; d date=(statement_timestamp() at time zone 'Asia/Taipei')::date;
begin
 if p_user is null or p_market is null or p_market not in ('tw','global') or p_question is null or jsonb_typeof(p_question)<>'object' then raise exception 'invalid daily request'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('arcana:daily:'||p_user::text||':'||d::text,0));
 select * into r from public.arcana_orders where user_id=p_user and daily_day=d;
 if found then return r; end if; -- first question and seed win; no reroll
 insert into public.arcana_orders(user_id,sku,amount_minor,currency,market,environment,request_key,question,daily_day,status)
 values(p_user,'daily',0,case p_market when 'tw' then 'TWD' else 'USD' end,p_market,'internal','daily:'||d::text,p_question,d,'paid') returning * into r;
 return r;
end $$;

create function public.bind_arcana_payment(p_order uuid,p_provider text,p_provider_order text,p_merchant_id text)
returns public.arcana_orders language plpgsql security invoker set search_path='' as $$
declare r public.arcana_orders;
begin
 if p_provider_order is null or length(p_provider_order) not between 1 and 255 or p_merchant_id is null or length(p_merchant_id) not between 1 and 255 then raise exception 'invalid provider binding'; end if;
 select * into r from public.arcana_orders where id=p_order for update;
 if not found or r.sku='daily' then raise exception 'unknown paid order'; end if;
 if p_provider is distinct from 'paypal' or r.market<>'global' or not exists(select 1 from public.arcana_catalog c where c.market=r.market and c.sku=r.sku and c.provider=p_provider) then raise exception 'provider unavailable'; end if;
 if r.provider_order_id is not null then
  if r.provider<>p_provider or r.provider_order_id<>p_provider_order or r.merchant_id<>p_merchant_id then raise exception 'binding conflict'; end if;
  return r;
 end if;
 if r.status<>'creating' then raise exception 'cannot bind closed order'; end if;
 update public.arcana_orders set provider=p_provider,provider_order_id=p_provider_order,merchant_id=p_merchant_id,status='created' where id=p_order returning * into r;
 return r;
end $$;

-- Caller must verify provider signature AND fetch provider order/capture, checking
-- environment, payee, ownership/custom_id, exact amount and currency first.
create function public.record_arcana_payment(p_order uuid,p_event_id text,p_provider text,p_provider_order text,p_capture text,p_state text,p_merchant_id text,p_amount_minor integer,p_currency text)
returns public.arcana_orders language plpgsql security invoker set search_path='' as $$
declare r public.arcana_orders; e public.arcana_payment_events; body jsonb;
begin
 if p_event_id is null or length(p_event_id) not between 1 and 255 or p_state is null or p_state not in ('approved','pending','paid','declined','voided','refunded','reversed') then raise exception 'invalid payment event'; end if;
 select * into r from public.arcana_orders where id=p_order for update;
 if not found or r.sku='daily' then raise exception 'unknown paid order'; end if;
 if p_provider is distinct from r.provider or p_provider is distinct from 'paypal' or r.market<>'global' or r.provider_order_id is null or p_provider_order is distinct from r.provider_order_id or p_merchant_id is distinct from r.merchant_id
    or p_amount_minor is distinct from r.amount_minor or p_currency is distinct from r.currency then raise exception 'payment mismatch'; end if;
 if p_state in ('paid','refunded','reversed') and (p_capture is null or length(p_capture) not between 1 and 255) then raise exception 'capture required'; end if;
 if r.provider_capture_id is not null and p_capture is not null and r.provider_capture_id<>p_capture then raise exception 'capture mismatch'; end if;
 body=jsonb_build_object('provider',p_provider,'order',p_order,'provider_order',p_provider_order,'capture',p_capture,'state',p_state,'merchant',p_merchant_id,'amount_minor',p_amount_minor,'currency',p_currency);
 select * into e from public.arcana_payment_events where event_id=p_event_id;
 if found then
  if e.order_id<>p_order or e.payload<>body then raise exception 'event replay mismatch'; end if;
  return r;
 end if;
 insert into public.arcana_payment_events(event_id,order_id,payload) values(p_event_id,p_order,body);
 -- Reversal/refund dominates every delayed completion, approval or pending event.
 if r.status='reversed' or (r.status='refunded' and p_state<>'reversed') then return r; end if;
 if r.status in ('declined','voided') and p_state not in ('refunded','reversed') then return r; end if;
 if r.status='paid' and p_state not in ('refunded','reversed') then return r; end if;
 if r.status='pending' and p_state='approved' then return r; end if;
 update public.arcana_orders set status=p_state,provider_capture_id=coalesce(provider_capture_id,p_capture) where id=p_order returning * into r;
 return r;
end $$;

create function public.fulfill_arcana_order(p_order uuid,p_result jsonb)
returns public.arcana_orders language plpgsql security invoker set search_path='' as $$
declare r public.arcana_orders; n integer;
begin
 select * into r from public.arcana_orders where id=p_order for update;
 if not found then raise exception 'unknown order'; end if;
 if r.status<>'paid' then raise exception 'entitlement not active'; end if;
 if r.result is not null then return r; end if; -- return canonical winner, never rerender/overwrite
 perform public.arcana_validate_result(r.sku,p_result);
 update public.arcana_orders set result=p_result where id=p_order returning * into r;
 return r;
end $$;

revoke all on function public.arcana_order_guard() from public,anon,authenticated;
revoke all on function public.reserve_arcana_order(uuid,text,text,text,jsonb,text),public.reserve_arcana_daily(uuid,jsonb,text),public.bind_arcana_payment(uuid,text,text,text),public.record_arcana_payment(uuid,text,text,text,text,text,text,integer,text),public.fulfill_arcana_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_arcana_order(uuid,text,text,text,jsonb,text),public.reserve_arcana_daily(uuid,jsonb,text),public.bind_arcana_payment(uuid,text,text,text),public.record_arcana_payment(uuid,text,text,text,text,text,text,integer,text),public.fulfill_arcana_order(uuid,jsonb) to service_role;
commit;
