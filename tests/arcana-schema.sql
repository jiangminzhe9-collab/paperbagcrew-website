-- LOCAL/DISPOSABLE DB TEST ONLY after applying docs/arcana-schema-draft.sql.
-- NOT EXECUTED against any connected project. Fixtures rollback; no payments.
begin;
do $$
declare buyer uuid=gen_random_uuid(); outsider uuid=gen_random_uuid();
 a public.arcana_orders; b public.arcana_orders; daily public.arcana_orders;
 q jsonb='{"questionId":"romance-state-02","language":"zh"}';
 result3 jsonb='{"cards":[{"id":74,"reversed":false},{"id":65,"reversed":true},{"id":62,"reversed":false}],"reading":{"direct":"fixture"},"reading_version":"test-v1"}';
 denied boolean; visible integer; i integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values
  (buyer,buyer::text||'@example.invalid',now()),(outsider,outsider::text||'@example.invalid',now());
 if exists(select 1 from public.arcana_catalog where market='global' and sku<>'daily' and (enabled or amount_minor is not null)) then raise exception 'FAIL production USD catalog not disabled'; end if;
 update public.arcana_catalog set amount_minor=1234,enabled=true where market='global' and sku='arcana_3'; -- SYNTHETIC TEST ONLY; rollback below
 set local role service_role;
 a=public.reserve_arcana_order(buyer,'test-a','arcana_3','sandbox',q,'global');
 b=public.reserve_arcana_order(buyer,'test-a','arcana_3','sandbox',q,'global');
 if a.id<>b.id or a.draw_seed<>b.draw_seed or a.amount_minor<>1234 or a.currency<>'USD' then raise exception 'FAIL idempotency/catalog/seed'; end if;
 b=public.reserve_arcana_order(buyer,'test-b','arcana_3','sandbox',q);
 if a.id=b.id then raise exception 'FAIL independent repeat purchases'; end if;
 b=public.reserve_arcana_order(buyer,'test-five','arcana_5','sandbox',q);
 if b.amount_minor<>499 then raise exception 'FAIL five-card catalog'; end if;
 denied=false;
 begin perform public.bind_arcana_payment(b.id,'paypal','TW-FORBIDDEN','TEST-MERCHANT'); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL TW PayPal forbidden'; end if;
 for i in 1..5 loop perform public.reserve_arcana_order(outsider,'cap-'||i,'arcana_3','sandbox',q); end loop;
 perform public.reserve_arcana_order(outsider,'cap-1','arcana_3','sandbox',q); -- retry still allowed
 denied=false;
 begin perform public.reserve_arcana_order(outsider,'cap-6','arcana_3','sandbox',q); exception when raise_exception then
  if SQLERRM='arcana_pending_limit' then denied=true; else raise; end if;
 end;
 if not denied then raise exception 'FAIL outstanding limit'; end if;
 denied=false;
 begin insert into public.arcana_orders(user_id,sku,amount_minor,currency,market,environment,request_key,question,status,result)
 values(buyer,'arcana_3',299,'TWD','tw','sandbox','forged',q,'paid',result3);
 exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL direct service forged paid insert'; end if;
 denied=false;
 begin update public.arcana_orders set status='paid' where id=b.id; exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL direct paid without binding'; end if;

 denied=false;
 begin perform public.reserve_arcana_order(buyer,'test-global','arcana_5','sandbox',q,'global'); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL unconfirmed USD catalog enabled'; end if;
 denied=false;
 begin perform public.reserve_arcana_order(buyer,'test-a','arcana_5','sandbox',q); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL idempotency collision'; end if;
 denied=false;
 begin perform public.reserve_arcana_order(buyer,'test-a','arcana_3','sandbox','{"different":true}'); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL question changed on retry'; end if;
 denied=false;
 begin perform public.fulfill_arcana_order(a.id,result3); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL unpaid fulfillment'; end if;
 reset role;
 update public.arcana_catalog set enabled=false where market='global' and sku='arcana_3';
 set local role service_role;
 -- Existing verified provider checkout must remain bindable after sales close.
 a=public.bind_arcana_payment(a.id,'paypal','TEST-ORDER-A','TEST-MERCHANT');
 denied=false;
 begin perform public.record_arcana_payment(a.id,'bad-price','paypal','TEST-ORDER-A','TEST-CAPTURE-A','paid','TEST-MERCHANT',1,'USD'); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL wrong amount'; end if;
 denied=false;
 begin perform public.record_arcana_payment(a.id,'bad-payee','paypal','TEST-ORDER-A','TEST-CAPTURE-A','paid','OTHER',1234,'USD'); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL wrong merchant'; end if;
 a=public.record_arcana_payment(a.id,'event-paid','paypal','TEST-ORDER-A','TEST-CAPTURE-A','paid','TEST-MERCHANT',1234,'USD');
 b=public.record_arcana_payment(a.id,'event-paid','paypal','TEST-ORDER-A','TEST-CAPTURE-A','paid','TEST-MERCHANT',1234,'USD');
 if b.status<>'paid' then raise exception 'FAIL replay'; end if;
 denied=false;
 begin perform public.record_arcana_payment(a.id,'event-paid','paypal','TEST-ORDER-A','TEST-CAPTURE-A','refunded','TEST-MERCHANT',1234,'USD'); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL altered event replay'; end if;
 denied=false;
 begin perform public.fulfill_arcana_order(a.id,jsonb_set(result3,'{cards,1,id}','74')); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL duplicate cards'; end if;
 a=public.fulfill_arcana_order(a.id,result3);
 b=public.fulfill_arcana_order(a.id,jsonb_set(result3,'{reading,direct}','"changed"'));
 if b.result<>result3 then raise exception 'FAIL result reroll'; end if;
 denied=false;
 begin update public.arcana_orders set result='{}' where id=a.id; exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL immutable result'; end if;
 daily=public.reserve_arcana_daily(buyer,q);
 b=public.reserve_arcana_daily(buyer,'{"questionId":"other"}','global');
 if daily.id<>b.id or daily.draw_seed<>b.draw_seed or b.question<>q or b.daily_day<>(statement_timestamp() at time zone 'Asia/Taipei')::date then raise exception 'FAIL canonical daily/day/seed'; end if;
 denied=false;
 begin update public.arcana_orders set result='{}' where id=daily.id; exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL direct malformed first result'; end if;
 denied=false;
 begin perform public.fulfill_arcana_order(daily.id,null); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL null result'; end if;
 daily=public.fulfill_arcana_order(daily.id,'{"cards":[{"id":0,"reversed":false}],"reading":{},"reading_version":"test-v1"}');
 perform set_config('request.jwt.claims',json_build_object('sub',buyer,'role','authenticated','is_anonymous',false)::text,true);
 set local role authenticated;
 select count(*) into visible from public.arcana_orders where id=a.id;
 if visible<>1 then raise exception 'FAIL owner cannot read'; end if;
 denied=false;
 begin update public.arcana_orders set status='paid' where id=a.id; exception when insufficient_privilege then denied=true; end;
 if not denied then raise exception 'FAIL client payment mutation'; end if;
 denied=false;
 begin perform public.reserve_arcana_daily(buyer,q); exception when insufficient_privilege then denied=true; end;
 if not denied then raise exception 'FAIL client privileged RPC'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated','is_anonymous',false)::text,true);
 select count(*) into visible from public.arcana_orders where id=a.id;
 if visible<>0 then raise exception 'FAIL outsider sees result'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',buyer,'role','authenticated','is_anonymous',true)::text,true);
 select count(*) into visible from public.arcana_orders where id=a.id;
 if visible<>0 then raise exception 'FAIL anonymous account sees result'; end if;
 reset role;
 set local role service_role;
 a=public.record_arcana_payment(a.id,'event-refund','paypal','TEST-ORDER-A','TEST-CAPTURE-A','refunded','TEST-MERCHANT',1234,'USD');
 b=public.record_arcana_payment(a.id,'late-paid','paypal','TEST-ORDER-A','TEST-CAPTURE-A','paid','TEST-MERCHANT',1234,'USD');
 if b.status<>'refunded' or b.result<>result3 then raise exception 'FAIL refund terminal/snapshot preserved'; end if;
 denied=false;
 begin perform public.fulfill_arcana_order(a.id,result3); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL revoked fulfillment'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',buyer,'role','authenticated','is_anonymous',false)::text,true);
 set local role authenticated;
 select count(*) into visible from public.arcana_orders where id=a.id;
 if visible<>0 then raise exception 'FAIL refunded result still readable'; end if;
 reset role;
end $$;
-- Privilege assertions cover every RPC, not only the one invoked above.
do $$ declare f record; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('reserve_arcana_order','reserve_arcana_daily','bind_arcana_payment','record_arcana_payment','fulfill_arcana_order') loop
  if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') then raise exception 'FAIL privileged RPC publicly callable'; end if;
 end loop;
end $$;
select 'PASS: transactional Arcana catalog, ownership, canonical reservation, immutable result, refund replay and grants' as checks;
rollback;
