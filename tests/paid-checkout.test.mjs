import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/paperbag-payments/index.mjs';
import {SKU,ORIGIN,canCheckout,buildPayPalOrder,validateOrder,captureState,canDownload,approvalURL} from '../supabase/functions/paperbag-payments/core.mjs';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const product={sku:SKU,title:'City Sessions Vol. 01',amount_cents:499,currency:'USD',enabled:true,file_ready:true,bucket:'paid-downloads',object_path:SKU+'/Paperbag-Crew-City-Sessions-Vol-01.zip'};
const local={id:'33333333-3333-4333-8333-333333333333',user_id:uid,sku:SKU,environment:'live',amount_cents:499,currency:'USD',status:'created',paypal_order_id:'ORDER123',created_at:new Date().toISOString()};
const cfg={mode:'live',clientId:'test-client',secret:'test-secret',merchantId:'MERCHANT123',webhookId:'WH123',liveEnabled:true,testUsers:[uid]};
const remoteOrder=()=>({...buildPayPalOrder(local,product,cfg.merchantId),id:'ORDER123',status:'APPROVED',links:[{rel:'payer-action',href:'https://www.paypal.com/checkoutnow?token=ORDER123'}]});
const capture=()=>({id:'CAPTURE123',status:'COMPLETED',amount:{value:'4.99',currency_code:'USD'}});
function fixture(overrides={}){
  const state={orders:[],remote:remoteOrder(),capture:capture(),calls:[],paidWrites:0,signs:0,signature:'SUCCESS',product:{...product},...overrides};
  const vars={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service',PAYPAL_MODE:'live',PAYPAL_CLIENT_ID:'test-client',PAYPAL_CLIENT_SECRET:'test-secret',PAYPAL_MERCHANT_ID:'MERCHANT123',PAYPAL_WEBHOOK_ID:'WH123',PBC_LIVE_CHECKOUT_ENABLED:'true',...overrides.env};
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  async function fetcher(url,opts={}){
    const u=new URL(url),method=opts.method||'GET',body=opts.body&&opts.headers?.['Content-Type']!=='application/x-www-form-urlencoded'?JSON.parse(opts.body):null;
    state.calls.push({url,method,body,headers:opts.headers});
    if(u.pathname==='/auth/v1/user'){
      const token=opts.headers.Authorization;
      return token==='Bearer member'?response({id:uid,email_confirmed_at:'2026-10-31'}):token==='Bearer other'?response({id:other,email_confirmed_at:'2026-10-31'}):response({},401);
    }
    if(u.pathname==='/rest/v1/commerce_products')return response([state.product]);
    if(u.pathname==='/rest/v1/rpc/reserve_commerce_order'){
      if(!state.orders.length)state.orders.push({...local,status:'creating',paypal_order_id:null});
      return response(overrides.rpcArray?[state.orders[0]]:state.orders[0]);
    }
    if(u.pathname==='/rest/v1/rpc/record_commerce_payment'){
      const order=state.orders.find(x=>x.id===body.p_order);
      if(!['refunded','reversed'].includes(order.status)&&!(order.status==='paid'&&['pending','declined'].includes(body.p_state))){order.status=body.p_state;order.paypal_capture_id=body.p_capture;state.paidWrites++;}
      return response(overrides.rpcArray?[order]:order);
    }
    if(u.pathname==='/rest/v1/commerce_orders'){
      const rows=state.orders.filter(o=>[...u.searchParams].every(([k,v])=>!['user_id','paypal_order_id','paypal_capture_id','sku','environment','id','status'].includes(k)||v==='is.null'?(!['paypal_order_id'].includes(k)||v!=='is.null'||o[k]===null):v.startsWith('eq.')?String(o[k])===v.slice(3):true));
      if(method==='PATCH')for(const row of rows)Object.assign(row,body);
      return response(rows);
    }
    if(u.pathname==='/rest/v1/commerce_webhook_events')return response({});
    if(u.pathname.startsWith('/storage/v1/object/sign/')){state.signs++;return response({signedURL:'/object/sign/paid-downloads/'+product.object_path+'?token=short-lived'});}
    if(u.pathname==='/v1/oauth2/token')return response({access_token:'paypal-test-token'});
    if(u.pathname==='/v1/notifications/verify-webhook-signature')return response({verification_status:state.signature});
    if(u.pathname==='/v2/checkout/orders'&&method==='POST')return response({...state.remote,status:'CREATED'},201);
    if(u.pathname==='/v2/checkout/orders/ORDER123/capture'){
      state.remote.status='COMPLETED';state.remote.purchase_units[0].payments={captures:[state.capture]};
      return overrides.captureTimeout?response({},500):response(state.remote,201);
    }
    if(u.pathname==='/v2/checkout/orders/ORDER123')return response(state.remote);
    if(u.pathname==='/v2/payments/captures/CAPTURE123')return response(state.capture);
    throw new Error('Unexpected mock request '+url);
  }
  const handler=createHandler(k=>vars[k],fetcher);
  async function request(path,body,token='member',headers={}){
    const r=await handler(new Request('https://test.supabase.co/functions/v1/paperbag-payments/'+path,{method:body?'POST':'GET',headers:{Origin:ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}));
    return {status:r.status,body:await r.json()};
  }
  const webhookHeaders={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.paypal.com/cert','paypal-transmission-id':'id','paypal-transmission-sig':'signature','paypal-transmission-time':new Date().toISOString()};
  return {state,request,handler,webhookHeaders};
}
test('checkout is closed unless credentials, artifact, live flag AND product switch are ready',()=>{
  assert(canCheckout(cfg,product));
  for(const key of ['clientId','secret','merchantId','webhookId','liveEnabled'])assert.equal(canCheckout({...cfg,[key]:null},product),false,key);
  assert.equal(canCheckout(cfg,{...product,enabled:false}),false);
  assert.equal(canCheckout(cfg,{...product,file_ready:false}),false);
  assert.equal(canCheckout({...cfg,mode:'oops'},product),false);
});
test('sandbox needs a specifically allowed signed-in member',()=>{
  assert(canCheckout({...cfg,mode:'sandbox'},product,{id:uid}));
  assert.equal(canCheckout({...cfg,mode:'sandbox'},product,{id:other}),false);
  assert.equal(canCheckout({...cfg,mode:'sandbox'},product,null),false);
});
for(const [label,change] of [
  ['amount',r=>r.purchase_units[0].amount.value='0.01'],['currency',r=>r.purchase_units[0].amount.currency_code='TWD'],
  ['merchant',r=>r.purchase_units[0].payee.merchant_id='ATTACKER'],['owner binding',r=>r.purchase_units[0].custom_id='different'],
  ['SKU',r=>r.purchase_units[0].reference_id='other'],['invoice',r=>r.purchase_units[0].invoice_id='other'],
  ['order',r=>r.id='DIFFERENT'],['intent',r=>r.intent='AUTHORIZE'],['extra units',r=>r.purchase_units.push(r.purchase_units[0])]
])test('rejects mismatched '+label,()=>{const r=remoteOrder();change(r);assert.throws(()=>validateOrder(r,local,cfg.merchantId));});
test('pending, refund and reversal do not give paid access',()=>{
  for(const [status,expected]of Object.entries({COMPLETED:'paid',PENDING:'pending',REFUNDED:'refunded',PARTIALLY_REFUNDED:'refunded',REVERSED:'reversed'}))assert.equal(captureState({...capture(),status},local),expected);
  assert.equal(canDownload({...local,status:'pending'},{id:uid},cfg),false);
  assert.equal(canDownload({...local,status:'paid'},{id:other},cfg),false);
  assert.equal(canDownload({...local,status:'paid',environment:'sandbox'},{id:uid},cfg),false);
});
test('PayPal redirect host is restricted',()=>{
  for(const href of ['https://evil.test','https://www.paypal.com.evil.test','http://www.paypal.com','https://user@www.paypal.com','https://www.paypal.com:123'])assert.throws(()=>approvalURL({links:[{rel:'approve',href}]},'live'));
});
test('unauthenticated purchase rejected and no upstream order created',async()=>{
  const f=fixture();assert.equal((await f.request('create',{sku:SKU},null)).status,401);assert.equal(f.state.orders.length,0);
});
test('server price wins over browser price and repeated create resumes same order',async()=>{
  const f=fixture();const body={sku:SKU,termsVersion:'2026-10-31',amount:'0.01',user_id:other};
  assert.equal((await f.request('create',body)).status,200);assert.equal((await f.request('create',body)).status,200);
  const creates=f.state.calls.filter(x=>x.url.endsWith('/v2/checkout/orders')&&x.method==='POST');
  assert.equal(creates.length,1);assert.equal(creates[0].body.purchase_units[0].amount.value,'4.99');
  assert.equal(f.state.orders[0].user_id,uid);assert.equal(creates[0].headers['PayPal-Request-Id'],'create-'+local.id);
});
test('forged return URL cannot unlock a purchase and another user cannot capture it',async()=>{
  const f=fixture({orders:[{...local}]});
  assert.equal((await f.request('capture',{orderId:'ORDER123'},'other')).status,404);
  assert.equal((await f.request('download',{sku:SKU})).status,403);assert.equal(f.state.signs,0);
});
test('successful capture and retry give one capture and an expiring signed ZIP',async()=>{
  const f=fixture({orders:[{...local}]});
  assert.equal((await f.request('capture',{orderId:'ORDER123'})).body.status,'paid');
  assert.equal((await f.request('capture',{orderId:'ORDER123'})).body.status,'paid');
  assert.equal(f.state.calls.filter(x=>x.url.endsWith('/capture')&&x.method==='POST').length,1);
  const result=await f.request('download',{sku:SKU});assert.equal(result.status,200);assert.match(result.body.url,/storage\/v1\/object\/sign\/paid-downloads/);assert.equal(result.body.expiresIn,120);
});
test('capture timeout is reconciled before customer is told to retry',async()=>{
  const f=fixture({orders:[{...local}],captureTimeout:true});assert.equal((await f.request('capture',{orderId:'ORDER123'})).body.status,'paid');
});
test('RPC single-row array is normalized before creating or granting an order',async()=>{
  const f=fixture({rpcArray:true});
  assert.equal((await f.request('create',{sku:SKU,termsVersion:'2026-10-31'})).status,200);
  assert.equal((await f.request('capture',{orderId:'ORDER123'})).body.status,'paid');
});
test('capture PENDING never signs download',async()=>{
  const f=fixture({orders:[{...local}],capture:{...capture(),status:'PENDING'}});assert.equal((await f.request('capture',{orderId:'ORDER123'})).body.status,'pending');assert.equal((await f.request('download',{sku:SKU})).status,403);
});
test('underpaid capture does not create entitlement',async()=>{
  const f=fixture({orders:[{...local}],capture:{...capture(),amount:{currency_code:'USD',value:'0.01'}}});assert.equal((await f.request('capture',{orderId:'ORDER123'})).status,409);assert.equal(f.state.paidWrites,0);
});
test('missing or invalid webhook signature is rejected without capture',async()=>{
  const f=fixture({orders:[{...local}],signature:'FAILURE'}),body={id:'EV1',event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:'ORDER123'}};
  assert.equal((await f.request('webhook',body,null)).status,400);
  assert.equal((await f.request('webhook',body,null,f.webhookHeaders)).status,401);assert.equal(f.state.paidWrites,0);
});
test('verified approval webhook delivers even after customer closes browser',async()=>{
  const f=fixture({orders:[{...local}]});const body={id:'EV1',event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:'ORDER123'}};
  assert.equal((await f.request('webhook',body,null,f.webhookHeaders)).status,200);assert.equal(f.state.orders[0].status,'paid');
  await f.request('webhook',body,null,f.webhookHeaders);assert.equal(f.state.calls.filter(x=>x.url.endsWith('/capture')&&x.method==='POST').length,1);
});
test('verified webhook recovers PayPal ID after create-save failure',async()=>{
  const f=fixture({orders:[{...local,paypal_order_id:null,status:'creating'}]});
  const result=await f.request('webhook',{id:'EVRECOVERY',event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:'ORDER123'}},null,f.webhookHeaders);
  assert.equal(result.status,200);assert.equal(f.state.orders[0].paypal_order_id,'ORDER123');assert.equal(f.state.orders[0].status,'paid');
});
test('refund webhook revokes access; delayed completion cannot restore it',async()=>{
  const f=fixture({orders:[{...local}]});await f.request('capture',{orderId:'ORDER123'});
  const body={id:'EV2',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'REFUND123',supplementary_data:{related_ids:{order_id:'ORDER123',capture_id:'CAPTURE123'}}}};
  assert.equal((await f.request('webhook',body,null,f.webhookHeaders)).status,200);assert.equal(f.state.orders[0].status,'refunded');
  await f.request('webhook',{...body,id:'EV3',event_type:'PAYMENT.CAPTURE.COMPLETED'},null,f.webhookHeaders);
  assert.equal((await f.request('download',{sku:SKU})).status,403);
});
test('unconfigured production stays closed',async()=>{
  const f=fixture({env:{PAYPAL_CLIENT_SECRET:''}});
  assert.equal((await f.request('catalog',null,null)).body.available,false);
  assert.equal((await f.request('create',{sku:SKU,termsVersion:'2026-10-31'})).status,503);
  assert.equal(f.state.orders.length,0);
});
test('cross-origin request rejected',async()=>{
  const f=fixture();assert.equal((await f.request('create',{sku:SKU},'member',{Origin:'https://evil.test'})).status,403);
});
