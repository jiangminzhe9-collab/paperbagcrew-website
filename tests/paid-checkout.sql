-- Run as project administrator. Every fixture is rolled back; no emails or payments.
begin;
do $$
declare
  buyer uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  first_order public.commerce_orders;
  again public.commerce_orders;
  denied boolean := false;
  visible integer;
begin
  insert into auth.users(id,email,email_confirmed_at)
    values(buyer,buyer::text||'@example.invalid',now()),(outsider,outsider::text||'@example.invalid',now());
  set local role service_role;
  first_order := public.reserve_commerce_order(buyer,'city-sessions-vol-01','sandbox');
  again := public.reserve_commerce_order(buyer,'city-sessions-vol-01','sandbox');
  if first_order.id <> again.id then raise exception 'FAIL: repeated checkout creates a second active order'; end if;
  if first_order.amount_cents <> 499 or first_order.currency <> 'USD' then raise exception 'FAIL: wrong price'; end if;
  begin
    insert into public.commerce_orders(user_id,sku,environment,amount_cents,currency)
      values(buyer,'city-sessions-vol-01','sandbox',499,'USD');
  exception when unique_violation then denied := true;
  end;
  if not denied then raise exception 'FAIL: active purchase uniqueness'; end if;
  perform public.record_commerce_payment(first_order.id,'TESTCAPTURE123','paid');
  perform public.record_commerce_payment(first_order.id,'TESTCAPTURE123','refunded');
  again := public.record_commerce_payment(first_order.id,'TESTCAPTURE123','paid');
  if again.status <> 'refunded' then raise exception 'FAIL: delayed completed event revived refunded access'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',buyer,'role','authenticated','is_anonymous',false)::text,true);
  set local role authenticated;
  select count(*) into visible from public.commerce_orders where id=first_order.id;
  if visible <> 1 then raise exception 'FAIL: buyer cannot read own order'; end if;
  denied := false;
  begin
    update public.commerce_orders set status='paid' where id=first_order.id;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: member can edit payment state'; end if;
  denied := false;
  begin
    perform public.record_commerce_payment(first_order.id,'TESTCAPTURE123','paid');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: member can invoke privileged payment RPC'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated','is_anonymous',false)::text,true);
  select count(*) into visible from public.commerce_orders where id=first_order.id;
  if visible <> 0 then raise exception 'FAIL: outsider sees buyer order'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',buyer,'role','authenticated','is_anonymous',true)::text,true);
  select count(*) into visible from public.commerce_orders where id=first_order.id;
  if visible <> 0 then raise exception 'FAIL: anonymous account sees orders'; end if;
  reset role;
  if (select public from storage.buckets where id='paid-downloads') then raise exception 'FAIL: paid bucket is public'; end if;
  if (select enabled from public.commerce_products where sku='city-sessions-vol-01') then raise exception 'FAIL: untested checkout enabled'; end if;
end $$;
select 'PASS: RLS ownership, privileged writes, duplicate order protection, refund replay, private storage, closed sales' as checks;
rollback;
