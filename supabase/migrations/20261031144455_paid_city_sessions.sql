-- Server-owned commerce records; the six free wallpaper choices are unchanged.
create table public.commerce_products (
  sku text primary key,
  title text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'USD'),
  enabled boolean not null default false,
  file_ready boolean not null default false,
  bucket text not null,
  object_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  file_bytes bigint not null check (file_bytes > 0)
);
create table public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  sku text not null references public.commerce_products(sku),
  environment text not null check (environment in ('sandbox','live')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'USD'),
  status text not null default 'creating' check (status in ('creating','created','pending','paid','declined','refunded','reversed','voided')),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  terms_version text not null default '2026-10-31'
);
-- A user can resume an unfinished purchase but cannot start a second active one.
create unique index commerce_one_active_purchase on public.commerce_orders(user_id,sku,environment)
  where status in ('creating','created','pending','paid');
create index commerce_orders_member_created on public.commerce_orders(user_id,created_at desc);
create index commerce_orders_sku on public.commerce_orders(sku);
create table public.commerce_webhook_events (
  event_id text primary key,
  event_type text not null,
  order_id uuid not null references public.commerce_orders(id),
  received_at timestamptz not null default now()
);
create index commerce_events_order on public.commerce_webhook_events(order_id);
alter table public.commerce_products enable row level security;
alter table public.commerce_orders enable row level security;
alter table public.commerce_webhook_events enable row level security;
revoke all on public.commerce_products, public.commerce_orders, public.commerce_webhook_events from public, anon, authenticated;
grant all on public.commerce_products, public.commerce_orders, public.commerce_webhook_events to service_role;
grant select on public.commerce_orders to authenticated;
create policy members_read_own_orders on public.commerce_orders for select to authenticated
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous','false') = 'false');

create function public.reserve_commerce_order(p_user uuid,p_sku text,p_environment text)
returns public.commerce_orders language plpgsql security invoker set search_path = '' as $$
declare result public.commerce_orders;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text || p_sku || p_environment,0));
  select * into result from public.commerce_orders
    where user_id=p_user and sku=p_sku and environment=p_environment
    and status in ('creating','created','pending','paid') order by created_at desc limit 1;
  if found then return result; end if;
  insert into public.commerce_orders(user_id,sku,environment,amount_cents,currency)
    select p_user,sku,p_environment,amount_cents,currency from public.commerce_products where sku=p_sku
    returning * into result;
  if result.id is null then raise exception 'Unknown product'; end if;
  return result;
end $$;

create function public.record_commerce_payment(p_order uuid,p_capture text,p_state text)
returns public.commerce_orders language plpgsql security invoker set search_path = '' as $$
declare result public.commerce_orders;
begin
  if p_state not in ('pending','paid','declined','refunded','reversed') or p_capture !~ '^[A-Z0-9]{1,36}$' then
    raise exception 'Invalid payment state';
  end if;
  select * into strict result from public.commerce_orders where id=p_order for update;
  if result.paypal_capture_id is not null and result.paypal_capture_id <> p_capture then raise exception 'Capture mismatch'; end if;
  -- Delayed completed/pending webhooks can never undo a refund or reversal.
  if result.status in ('refunded','reversed') then return result; end if;
  if result.status='paid' and p_state in ('pending','declined') then return result; end if;
  update public.commerce_orders set status=p_state,paypal_capture_id=p_capture,updated_at=now(),
    paid_at=case when p_state='paid' then coalesce(paid_at,now()) else paid_at end
    where id=p_order returning * into result;
  return result;
end $$;
revoke all on function public.reserve_commerce_order(uuid,text,text), public.record_commerce_payment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_commerce_order(uuid,text,text), public.record_commerce_payment(uuid,text,text) to service_role;

insert into public.commerce_products(sku,title,amount_cents,currency,bucket,object_path,sha256,file_bytes)
values ('city-sessions-vol-01','City Sessions Vol. 01',499,'USD','paid-downloads','city-sessions-vol-01/Paperbag-Crew-City-Sessions-Vol-01.zip',
 '5a8e5b90718e5c35e90b7c501fb4ef901543f5f104102a13e6f4296379135f1e',29291167);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('paid-downloads','paid-downloads',false,52428800,array['application/zip']);
-- No client Storage policy: only the server issues short-lived download URLs.
