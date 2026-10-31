-- Local disposable PostgreSQL only. Synthetic price/identity rolled back.
begin;
do $$
declare u uuid=gen_random_uuid(); o public.arcana_orders; r public.arcana_orders; denied boolean;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u::text||'@example.invalid',now());
 update public.arcana_catalog set amount_minor=1234,enabled=true where market='global' and sku='arcana_3';
 set local role service_role;
 o=public.reserve_arcana_order(u,'rls-edge','arcana_3','sandbox','{"questionId":"romance-state-02","language":"en"}','global');
 o=public.bind_arcana_payment(o.id,'paypal','EDGEORDER','EDGEMERCHANT');
 -- A verified refund can arrive before a completion callback.
 o=public.record_arcana_payment(o.id,'edge-refund','paypal','EDGEORDER','EDGECAPTURE','refunded','EDGEMERCHANT',1234,'USD');
 r=public.record_arcana_payment(o.id,'edge-late-paid','paypal','EDGEORDER','EDGECAPTURE','paid','EDGEMERCHANT',1234,'USD');
 if r.status<>'refunded' or r.result is not null then raise exception 'FAIL refund before completion'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated','is_anonymous',false)::text,true);
 set local role authenticated;
 denied=false;begin perform draw_seed from public.arcana_orders limit 1;exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL client seed column readable'; end if;
 denied=false;begin perform provider_order_id from public.arcana_orders limit 1;exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL client provider order column readable'; end if;
 denied=false;begin perform provider_capture_id from public.arcana_orders limit 1;exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL client capture column readable'; end if;
 set local role anon;
 denied=false;begin perform id from public.arcana_orders limit 1;exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL anonymous order column readable'; end if;
 reset role;
end $$;
rollback;
