import test from 'node:test';
import assert from 'node:assert/strict';
import {renderReading as actualRender, validateQuestion as actualValidate} from '../supabase/functions/arcana-service/renderer.mjs';
import {createHandler} from '../supabase/functions/arcana-service/index.mjs';
import {CATALOG,ORIGIN,amountValue,buildPayPalOrder,validateOrder,captureState,approvalURL,publicOrder,validateResult} from '../supabase/functions/arcana-service/core.mjs';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const key='33333333-3333-4333-8333-333333333333',seed='44444444-4444-4444-8444-444444444444';
const baseOrder={id:'55555555-5555-4555-8555-555555555555',user_id:uid,sku:'arcana_3',market:'tw',amount_minor:299,currency:'TWD',environment:'sandbox',provider:'paypal',request_key:key,draw_seed:seed,question:{questionId:'work-state',language:'en'},status:'created',provider_order_id:'ORDER123',provider_capture_id:null,created_at:'2026-10-31T12:00:00Z',result:null};
const now=()=>Date.parse('2026-10-31T13:00:00Z');
const clone=x=>JSON.parse(JSON.stringify(x));
const remoteFor=o=>({...buildPayPalOrder(o,'MERCHANT123'),id:o.provider_order_id||'ORDER123',status:'APPROVED',links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token='+(o.provider_order_id||'ORDER123')}]});
const captureFor=o=>({id:'CAPTURE123',status:'COMPLETED',amount:{currency_code:o.currency,value:amountValue(o.amount_minor,o.currency)},supplementary_data:{related_ids:{order_id:o.provider_order_id}},invoice_id:o.id,custom_id:o.id});
const readingFor=o=>({cards:Array.from({length:o.sku==='daily'?1:o.sku==='arcana_3'?3:5},(_,id)=>({id,reversed:false})),reading:{answer:'A server-generated reading.',seed:o.draw_seed},reading_version:'test-v1'});
const createBody={sku:'arcana_3',market:'tw',requestKey:key,question:baseOrder.question,termsVersion:'2026-10-31'};
// Synthetic provider policy is DI only; production index.ts never overrides TW's disabled policy.
function fixture(overrides={}){
  const state={orders:[],events:new Map(),remotes:new Map(),captures:new Map(),calls:[],signature:'SUCCESS',renderCount:0,fulfillmentWrites:0,paymentWrites:0,createCount:0,captureCount:0,clockDay:'2026-10-31',...overrides};
  state.orders=clone(state.orders);
  for(const o of state.orders)if(o.sku!=='daily'&&o.provider_order_id){state.remotes.set(o.provider_order_id,remoteFor(o));state.captures.set('CAPTURE123',captureFor(o));}
  const vars={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'TEST_SERVICE_ONLY',ARCANA_SERVICE_ENABLED:'true',ARCANA_CHECKOUT_ENABLED:'true',ARCANA_PAYPAL_MODE:'sandbox',ARCANA_PAYPAL_CLIENT_ID:'TEST_CLIENT',ARCANA_PAYPAL_CLIENT_SECRET:'TEST_SECRET',ARCANA_PAYPAL_MERCHANT_ID:'MERCHANT123',ARCANA_PAYPAL_WEBHOOK_ID:'WH123',ARCANA_SANDBOX_USER_IDS:uid,...overrides.env};
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const conflict=()=>response({code:'P0001',message:'conflict'},409);
  const orderBy=id=>state.orders.find(o=>o.id===id);
  function newOrder(data){return {...clone(baseOrder),id:state.orders.length?'66666666-6666-4666-8666-'+String(state.orders.length).padStart(12,'0'):baseOrder.id,provider_order_id:null,provider:null,status:'creating',...data};}
  async function fetcher(url,options={}){
    const u=new URL(url),method=options.method||'GET';
    const body=options.body&&options.headers?.['Content-Type']!=='application/x-www-form-urlencoded'?JSON.parse(options.body):null;
    state.calls.push({url,method,body,headers:options.headers});
    if(u.pathname==='/auth/v1/user'){
      const token=options.headers.Authorization;
      if(token==='Bearer member')return response({id:uid,is_anonymous:false,email_confirmed_at:'2026-10-01',...state.user});
      if(token==='Bearer other')return response({id:other,is_anonymous:false,email_confirmed_at:'2026-10-01'});
      return response({},401);
    }
    if(u.pathname==='/rest/v1/arcana_catalog')return response(state.catalog||Object.values(CATALOG).map(p=>({market:'tw',sku:p.sku,currency:p.currency,amount_minor:p.amountMinor,enabled:true,provider:'paypal'})));
    if(u.pathname==='/rest/v1/rpc/reserve_arcana_order'){
      if(state.pendingLimit)return response({code:'P0001',message:'arcana_pending_limit'},409);
      let row=state.orders.find(o=>o.user_id===body.p_user&&o.request_key===body.p_request_key);
      if(row&&(row.sku!==body.p_sku||row.market!==body.p_market||JSON.stringify(row.question)!==JSON.stringify(body.p_question)))return conflict();
      if(!row){row=newOrder({user_id:body.p_user,request_key:body.p_request_key,sku:body.p_sku,question:body.p_question,environment:body.p_environment,market:body.p_market,amount_minor:CATALOG[body.p_sku].amountMinor});state.orders.push(row);}
      return response(row);
    }
    if(u.pathname==='/rest/v1/rpc/reserve_arcana_daily'){
      let row=state.orders.find(o=>o.user_id===body.p_user&&o.daily_day===state.clockDay);
      if(!row){row=newOrder({user_id:body.p_user,sku:'daily',market:body.p_market,currency:body.p_market==='global'?'USD':'TWD',amount_minor:0,environment:'internal',question:body.p_question,status:'paid',daily_day:state.clockDay,request_key:'daily:'+state.clockDay});state.orders.push(row);}
      return response(row);
    }
    if(u.pathname==='/rest/v1/rpc/bind_arcana_payment'){
      const row=orderBy(body.p_order);
      if(state.bindFail){state.bindFail=false;return response({},500);}
      if(body.p_provider!=='paypal'||(row.provider_order_id&&row.provider_order_id!==body.p_provider_order))return conflict();
      row.provider='paypal';row.provider_order_id=body.p_provider_order;row.merchant_id=body.p_merchant_id;if(row.status==='creating')row.status='created';return response(row);
    }
    if(u.pathname==='/rest/v1/rpc/record_arcana_payment'){
      const row=orderBy(body.p_order);
      if(body.p_provider!==row.provider||row.provider_order_id!==body.p_provider_order||row.amount_minor!==body.p_amount_minor||row.currency!==body.p_currency||body.p_merchant_id!=='MERCHANT123'||(row.provider_capture_id&&body.p_capture&&row.provider_capture_id!==body.p_capture))return conflict();
      const existing=state.events.get(body.p_event_id);
      if(existing&&JSON.stringify(existing)!==JSON.stringify(body))return conflict();
      state.events.set(body.p_event_id,body);
      if(!['refunded','reversed'].includes(row.status)&&!(row.status==='paid'&&!['refunded','reversed'].includes(body.p_state))){row.status=body.p_state;state.paymentWrites++;}
      if(body.p_capture)row.provider_capture_id=body.p_capture;
      return response(row);
    }
    if(u.pathname==='/rest/v1/rpc/fulfill_arcana_order'){
      const row=orderBy(body.p_order);
      if(row.status!=='paid')return conflict();
      if(!row.result){row.result=body.p_result;state.fulfillmentWrites++;}return response(row);
    }
    if(u.pathname==='/rest/v1/arcana_orders'){
      return response(state.orders.filter(o=>[...u.searchParams].every(([k,v])=>['id','user_id','provider_order_id','provider_capture_id','environment'].includes(k)?String(o[k])===v.slice(3):true)).slice().reverse());
    }
    if(u.pathname==='/v1/oauth2/token')return response({access_token:'TEST_TOKEN'});
    if(u.pathname==='/v1/notifications/verify-webhook-signature')return response({verification_status:state.signature});
    if(u.pathname==='/v2/checkout/orders'&&method==='POST'){
      state.createCount++;
      const row=orderBy(body.purchase_units[0].custom_id),id=row.id===baseOrder.id?'ORDER123':'ORDER'+String(state.orders.indexOf(row)+1);
      let remote=state.remotes.get(id);if(!remote){remote={...body,id,status:'CREATED',links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token='+id}]};state.remotes.set(id,remote);state.captures.set('CAPTURE123',captureFor({...row,provider_order_id:id}));}
      if(state.createTimeout){state.createTimeout=false;return response({},500);}return response(remote,201);
    }
    const capturePath=u.pathname.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)\/capture$/);
    if(capturePath){
      state.captureCount++;const remote=state.remotes.get(capturePath[1]),capture=state.captures.get('CAPTURE123');remote.status='COMPLETED';remote.purchase_units[0].payments={captures:[capture]};
      if(state.captureTimeout){state.captureTimeout=false;return response({},500);}return response(remote,201);
    }
    const orderPath=u.pathname.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)$/);if(orderPath)return response(state.remotes.get(orderPath[1])||{},state.remotes.has(orderPath[1])?200:404);
    const getCapture=u.pathname.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)$/);if(getCapture)return response(state.captures.get(getCapture[1])||{},state.captures.has(getCapture[1])?200:404);
    if(u.pathname==='/v2/payments/refunds/REFUND123')return response(state.refund||{id:'REFUND123',status:'COMPLETED',amount:{currency_code:'TWD',value:'299'},links:[{href:'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE123'}]});
    throw new Error('Unexpected mock request '+url);
  }
  const validateQuestion=(q,sku)=>{
    assert(q&&typeof q==='object');assert(Object.keys(q).every(k=>(sku==='daily'?['language']:['questionId','language','optionA','optionB']).includes(k)));assert(['en','zh'].includes(q.language));if(sku!=='daily')assert(['work-state','love-action'].includes(q.questionId));return clone(q);
  };
  const renderReading=async order=>{
    state.renderCount++;
    if(state.renderFail){state.renderFail=false;throw new Error('temporary render failure');}
    if(state.refundWhileRender)orderBy(order.id).status='refunded';
    return state.badResult||readingFor(order);
  };
  const handler=createHandler(k=>vars[k],fetcher,{renderReading:overrides.actualRenderer?actualRender:renderReading,validateQuestion:overrides.actualRenderer?actualValidate:validateQuestion,now,...(overrides.productionPolicy?{}:{providerForMarket:()=> 'paypal'})});
  async function request(path,body,token='member',headers={}){
    const r=await handler(new Request('https://test.supabase.co/functions/v1/arcana-service/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
    return {status:r.status,body:await r.json()};
  }
  const webhookHeaders={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.paypal.com/cert','paypal-transmission-id':'event-transmission','paypal-transmission-sig':'TEST_SIGNATURE','paypal-transmission-time':'2026-10-31T13:00:00Z'};
  function completed(){const remote=state.remotes.get('ORDER123');remote.status='COMPLETED';remote.purchase_units[0].payments={captures:[state.captures.get('CAPTURE123')]};}
  return {state,handler,request,webhookHeaders,completed};
}
test('server catalog whole TWD; pending USD is explicitly unavailable',async()=>{
  const f=fixture(),r=await f.request('catalog',undefined,null);assert.equal(r.status,200);assert.equal(r.body.checkoutAvailable,false);
  assert.deepEqual(r.body.products.filter(p=>p.market==='tw').map(p=>p.amountValue),['299','499']);
  for(const p of r.body.products.filter(p=>p.market==='global')){assert.equal(p.currency,'USD');assert.equal(p.amountMinor,null);assert.equal(p.enabled,false);}
  assert.equal(amountValue(999,'USD'),'9.99');assert.equal(amountValue(299,'TWD'),'299');
});
test('disabled service does not contact auth, DB or payments',async()=>{const f=fixture({env:{ARCANA_SERVICE_ENABLED:'false'}});assert.equal((await f.request('daily',{market:'tw',question:{language:'en'}})).status,503);assert.equal(f.state.calls.length,0);});
test('live checkout requires independent live switch',async()=>{const f=fixture({env:{ARCANA_PAYPAL_MODE:'live'}});assert.equal((await f.request('create',createBody)).status,503);assert.equal(f.state.orders.length,0);});
test('sandbox only allows listed verified members',async()=>{const f=fixture();assert.equal((await f.request('create',createBody,'other')).status,503);assert.equal(f.state.orders.length,0);});
for(const user of [{is_anonymous:true},{email_confirmed_at:null},{is_anonymous:undefined}])test('rejects anonymous/unverified/unspecified membership '+JSON.stringify(user),async()=>{const f=fixture({user});assert.equal((await f.request('daily',{market:'tw',question:{language:'en'}})).status,403);assert.equal(f.state.orders.length,0);});
test('missing and expired bearer cannot reserve',async()=>{const f=fixture();for(const t of [null,'expired'])assert.equal((await f.request('create',createBody,t)).status,401);assert.equal(f.state.orders.length,0);});
test('malicious origin denied without touching auth',async()=>{const f=fixture();assert.equal((await f.request('create',createBody,'member',{Origin:'https://evil.example'})).status,403);assert.equal(f.state.calls.length,0);});
test('client price, owner, cards and results are rejected, never used',async()=>{for(const extra of [{amount:1},{user_id:other},{cards:[1]},{result:{paid:true}}]){const f=fixture();assert.equal((await f.request('create',{...createBody,...extra})).status,400);assert.equal(f.state.orders.length,0);}});
test('question rejects hidden cards and market cannot be inferred from language',async()=>{const f=fixture();assert.equal((await f.request('create',{...createBody,question:{...createBody.question,cards:[1]}})).status,400);assert.equal((await f.request('create',{...createBody,market:undefined})).status,400);assert.equal((await f.request('create',{...createBody,market:'global',question:{...createBody.question,language:'zh'}})).status,503);});
test('same user/key resumes same order; new key creates another legitimate purchase',async()=>{const f=fixture();const a=await f.request('create',createBody),b=await f.request('create',createBody);assert.equal(a.status,200);assert.equal(a.body.reference,b.body.reference);assert.equal(f.state.createCount,1);const c=await f.request('create',{...createBody,requestKey:'77777777-7777-4777-8777-777777777777'});assert.equal(c.status,200);assert.notEqual(c.body.reference,a.body.reference);assert.equal(f.state.orders.length,2);});
test('same key cannot silently change question or product',async()=>{const f=fixture();await f.request('create',createBody);assert.equal((await f.request('create',{...createBody,sku:'arcana_5'})).status,409);assert.equal((await f.request('create',{...createBody,question:{questionId:'love-action',language:'en'}})).status,409);assert.equal(f.state.orders.length,1);});
test('create request uses server amount, merchant and local invoice; callback contains local reference',async()=>{const f=fixture();await f.request('create',createBody);const call=f.state.calls.find(c=>c.url.endsWith('/v2/checkout/orders'));const u=call.body.purchase_units[0];assert.equal(u.amount.value,'299');assert.equal(u.amount.currency_code,'TWD');assert.equal(u.custom_id,baseOrder.id);assert.equal(u.invoice_id,baseOrder.id);assert.equal(u.payee.merchant_id,'MERCHANT123');assert(call.body.payment_source.paypal.experience_context.return_url.includes('?reference='+baseOrder.id));});
test('create response loss retries same provider idempotency key',async()=>{const f=fixture({createTimeout:true});assert.equal((await f.request('create',createBody)).status,502);const r=await f.request('create',createBody);assert.equal(r.status,200);const calls=f.state.calls.filter(c=>c.url.endsWith('/v2/checkout/orders'));assert.equal(new Set(calls.map(c=>c.headers['PayPal-Request-Id'])).size,1);assert.equal(f.state.orders.length,1);});
test('old unbound uncertain checkout does not create a new remote order',async()=>{const f=fixture({orders:[{...baseOrder,provider_order_id:null,status:'creating',created_at:'2026-10-30T00:00:00Z'}]});assert.equal((await f.request('resume',{reference:baseOrder.id})).status,409);assert.equal(f.state.createCount,0);});
test('cross-user access and forged return identifiers cannot capture or read',async()=>{const f=fixture({orders:[baseOrder]});for(const path of ['capture','status','resume'])assert.equal((await f.request(path,{reference:baseOrder.id},'other')).status,404);assert.equal(f.state.captureCount,0);assert.deepEqual((await f.request('history',undefined,'other')).body.orders,[]);});
for(const [label,mutate]of [ ['amount',r=>r.purchase_units[0].amount.value='2.99'],['currency',r=>r.purchase_units[0].amount.currency_code='USD'],['merchant',r=>r.purchase_units[0].payee.merchant_id='BAD'],['custom',r=>r.purchase_units[0].custom_id=other],['invoice',r=>r.purchase_units[0].invoice_id=other],['sku',r=>r.purchase_units[0].reference_id='arcana_5'],['id',r=>r.id='OTHER'],['intent',r=>r.intent='AUTHORIZE'],['units',r=>r.purchase_units.push(r.purchase_units[0])] ])test('rejects payment mismatch '+label,()=>{const r=remoteFor(baseOrder);mutate(r);assert.throws(()=>validateOrder(r,baseOrder,'MERCHANT123'));});
test('capture must bind exact order, amount, currency and optional invoice',()=>{for(const patch of [{amount:{currency_code:'TWD',value:'299.00'}},{supplementary_data:{related_ids:{order_id:'OTHER'}}},{invoice_id:'OTHER'},{custom_id:'OTHER'}])assert.throws(()=>captureState({...captureFor(baseOrder),...patch},baseOrder));});
test('pending payment never renders or exposes a result',async()=>{const f=fixture({orders:[baseOrder]});f.completed();f.state.captures.get('CAPTURE123').status='PENDING';const r=await f.request('status',{reference:baseOrder.id});assert.equal(r.body.status,'pending');assert.equal(r.body.result,null);assert.equal(f.state.renderCount,0);});
test('capture timeout is reconciled; repeated capture returns identical persisted result once',async()=>{const f=fixture({orders:[baseOrder],captureTimeout:true});const a=await f.request('capture',{reference:baseOrder.id}),b=await f.request('capture',{reference:baseOrder.id});assert.equal(a.body.status,'paid');assert.deepEqual(a.body.result,b.body.result);assert.equal(f.state.captureCount,1);assert.equal(f.state.fulfillmentWrites,1);});
test('renderer failure stays paid/retryable and retry uses same seed without payment',async()=>{const f=fixture({orders:[baseOrder],renderFail:true});const a=await f.request('capture',{reference:baseOrder.id});assert.equal(a.body.status,'paid');assert.equal(a.body.fulfillment,'retryable');const b=await f.request('status',{reference:baseOrder.id});assert.equal(b.body.fulfillment,'ready');assert.equal(b.body.result.reading.seed,seed);assert.equal(f.state.captureCount,1);});
test('invalid renderer card count is not persisted and remains retryable',async()=>{const f=fixture({orders:[baseOrder],badResult:{...readingFor(baseOrder),cards:[{id:1,reversed:false}]}});const r=await f.request('capture',{reference:baseOrder.id});assert.equal(r.body.fulfillment,'retryable');assert.equal(f.state.fulfillmentWrites,0);});
test('refund racing fulfillment cannot expose generated result',async()=>{const f=fixture({orders:[baseOrder],refundWhileRender:true});const r=await f.request('capture',{reference:baseOrder.id});assert.equal(r.body.status,'refunded');assert.equal(r.body.result,null);assert.equal(f.state.fulfillmentWrites,0);});
test('concurrent status retries persist one reading, same frozen seed',async()=>{const f=fixture({orders:[baseOrder]});f.completed();const rs=await Promise.all(Array.from({length:8},()=>f.request('status',{reference:baseOrder.id})));assert(rs.every(r=>r.status===200&&r.body.status==='paid'));assert.equal(new Set(rs.map(r=>JSON.stringify(r.body.result))).size,1);assert.equal(f.state.fulfillmentWrites,1);});
test('daily quota server-day is shared across markets/questions; midnight creates next day',async()=>{const f=fixture();const a=await f.request('daily',{market:'tw',question:{language:'zh'}}),b=await f.request('daily',{market:'global',question:{language:'en'}});assert.equal(a.body.reference,b.body.reference);assert.deepEqual(a.body.result,b.body.result);assert.equal(b.body.question.language,'zh');assert.equal(f.state.orders.length,1);f.state.clockDay='2026-11-01';const c=await f.request('daily',{market:'global',question:{language:'en'}});assert.notEqual(c.body.reference,a.body.reference);assert.equal(c.body.currency,'USD');assert.equal(c.body.amountValue,'0.00');});
test('concurrent daily requests return same single saved result',async()=>{const f=fixture();const rs=await Promise.all(Array.from({length:8},()=>f.request('daily',{market:'tw',question:{language:'en'}})));assert.equal(f.state.orders.length,1);assert.equal(f.state.fulfillmentWrites,1);assert.equal(new Set(rs.map(r=>r.body.reference)).size,1);});
test('webhook missing or forged signature never alters payment',async()=>{const f=fixture({orders:[baseOrder]});f.completed();const event={id:'EV1',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:captureFor(baseOrder)};assert.equal((await f.request('webhook',event,null)).status,400);f.state.signature='FAILURE';assert.equal((await f.request('webhook',event,null,f.webhookHeaders)).status,401);assert.equal(f.state.paymentWrites,0);});
test('signed completion uses fresh canonical capture, not webhook assertion',async()=>{const f=fixture({orders:[baseOrder]});f.completed();f.state.captures.get('CAPTURE123').status='PENDING';const r=await f.request('webhook',{id:'EV1',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:captureFor(baseOrder)},null,f.webhookHeaders);assert.equal(r.status,200);assert.equal(f.state.orders[0].status,'pending');assert.equal(f.state.fulfillmentWrites,0);});
test('signed refund revokes before stale COMPLETED can grant and late duplicate cannot reopen',async()=>{const f=fixture({orders:[baseOrder]});f.completed();const refund={id:'EVREFUND',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'REFUND123',supplementary_data:{related_ids:{order_id:'ORDER123',capture_id:'CAPTURE123'}}}};assert.equal((await f.request('webhook',refund,null,f.webhookHeaders)).status,200);assert.equal(f.state.orders[0].status,'refunded');assert.equal(f.state.fulfillmentWrites,0);for(let i=0;i<2;i++)assert.equal((await f.request('webhook',{id:'EVLATE',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:captureFor(baseOrder)},null,f.webhookHeaders)).status,200);assert.equal(f.state.orders[0].status,'refunded');assert.equal((await f.request('status',{reference:baseOrder.id})).body.result,null);});
test('partial refund revokes access too; unrelated refund cannot revoke',async()=>{const f=fixture({orders:[baseOrder]});f.completed();f.state.refund={id:'REFUND123',status:'COMPLETED',amount:{currency_code:'TWD',value:'1'},links:[{href:'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE123'}]};const e={id:'EVPARTIAL',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'REFUND123',supplementary_data:{related_ids:{order_id:'ORDER123',capture_id:'OTHER'}}}};assert.equal((await f.request('webhook',e,null,f.webhookHeaders)).status,409);e.resource.supplementary_data.related_ids.capture_id='CAPTURE123';assert.equal((await f.request('webhook',e,null,f.webhookHeaders)).status,200);assert.equal(f.state.orders[0].status,'refunded');});
test('reversal before completion is terminal',async()=>{const f=fixture({orders:[baseOrder]});f.completed();assert.equal((await f.request('webhook',{id:'EVREV',event_type:'PAYMENT.CAPTURE.REVERSED',resource:captureFor(baseOrder)},null,f.webhookHeaders)).status,200);assert.equal(f.state.orders[0].status,'reversed');assert.equal(f.state.fulfillmentWrites,0);});
test('bind response failure can be recovered by signed order webhook',async()=>{const f=fixture({bindFail:true});assert.equal((await f.request('create',createBody)).status,502);f.state.remotes.get('ORDER123').status='APPROVED';const r=await f.request('webhook',{id:'EVAPPROVED',event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:'ORDER123'}},null,f.webhookHeaders);assert.equal(r.status,200);assert.equal(f.state.orders[0].provider_order_id,'ORDER123');assert.equal(f.state.orders[0].status,'paid');});
test('history excludes seed, provider IDs and other owners, masks revoked result',async()=>{const f=fixture({orders:[{...baseOrder,status:'refunded',result:readingFor(baseOrder)},{...baseOrder,id:other,user_id:other}]});const r=await f.request('history');assert.equal(r.body.orders.length,1);assert.equal(r.body.orders[0].result,null);assert(!JSON.stringify(r.body).includes('provider_order_id'));assert(!JSON.stringify(r.body).includes('draw_seed'));});
test('approval URLs reject impostor hosts, userinfo, ports and protocol',()=>{for(const href of ['http://www.sandbox.paypal.com','https://www.sandbox.paypal.com.evil.test','https://u@www.sandbox.paypal.com','https://www.sandbox.paypal.com:123','https://www.paypal.com'])assert.throws(()=>approvalURL({links:[{rel:'approve',href}]},'sandbox'));});
test('invalid result duplicate cards or out of range never passes server validation',()=>{for(const cards of [[{id:1,reversed:false},{id:1,reversed:false},{id:2,reversed:false}],[{id:78,reversed:false},{id:1,reversed:false},{id:2,reversed:false}]])assert.throws(()=>validateResult({...readingFor(baseOrder),cards},baseOrder));});
test('public order never exposes pending or revoked result even if stored',()=>{for(const status of ['pending','refunded','reversed','voided','declined'])assert.equal(publicOrder({...baseOrder,status,result:readingFor(baseOrder)}).result,null);});

test('same signed event can reconcile newer canonical state without event-payload conflict',async()=>{const f=fixture({orders:[baseOrder]});f.completed();f.state.captures.get('CAPTURE123').status='PENDING';const e={id:'EVSAME',event_type:'PAYMENT.CAPTURE.PENDING',resource:captureFor(baseOrder)};assert.equal((await f.request('webhook',e,null,f.webhookHeaders)).status,200);f.state.captures.get('CAPTURE123').status='COMPLETED';assert.equal((await f.request('webhook',e,null,f.webhookHeaders)).status,200);assert.equal(f.state.orders[0].status,'paid');assert.equal(f.state.fulfillmentWrites,1);});
test('actual 78-card renderer integrates through paid persistence and daily service',async()=>{const question={questionId:'romance-state-02',language:'zh'};const f=fixture({orders:[{...baseOrder,question}],actualRenderer:true});const paid=await f.request('capture',{reference:baseOrder.id});assert.equal(paid.status,200);assert.equal(paid.body.result.cards.length,3);assert.equal(paid.body.result.reading.plain.cardNotes.length,3);assert(!JSON.stringify(paid.body).includes(seed));const daily=await f.request('daily',{market:'global',question:{language:'en'}});assert.equal(daily.status,200);assert.equal(daily.body.result.cards.length,1);assert.equal(daily.body.result.reading.kind,'daily');});

test('catalog reflects DB close or wrong price instead of static availability',async()=>{const f=fixture({catalog:[{market:'tw',sku:'arcana_3',currency:'TWD',amount_minor:1,enabled:true},{market:'tw',sku:'arcana_5',currency:'TWD',amount_minor:499,enabled:false}]});const r=await f.request('catalog');assert.equal(r.body.checkoutAvailable,false);assert(r.body.products.every(p=>p.enabled===false));assert.equal((await f.request('create',createBody)).status,503);assert.equal(f.state.createCount,0);});
test('pausing new service does not disable completion or refund webhooks',async()=>{const f=fixture({orders:[baseOrder],env:{ARCANA_SERVICE_ENABLED:'false',ARCANA_CHECKOUT_ENABLED:'false'}});const capture=await f.request('capture',{reference:baseOrder.id});assert.equal(capture.body.status,'paid');assert.equal((await f.request('create',createBody)).status,503);const r=await f.request('webhook',{id:'EVPAUSED',event_type:'PAYMENT.CAPTURE.REVERSED',resource:captureFor(baseOrder)},null,f.webhookHeaders);assert.equal(r.status,200);assert.equal(f.state.orders[0].status,'reversed');});
test('body streaming stops after 64 KiB without Content-Length',async()=>{const f=fixture();let chunks=0,cancelled=false;const stream=new ReadableStream({pull(c){chunks++;c.enqueue(new Uint8Array(32768).fill(32));},cancel(){cancelled=true;}});const req=new Request('https://test.supabase.co/functions/v1/arcana-service/daily',{method:'POST',headers:{Authorization:'Bearer member'},body:stream,duplex:'half'});const r=await f.handler(req);assert.equal(r.status,413);assert(cancelled);assert(chunks<=4);assert.equal(f.state.orders.length,0);});

test('webhook asks provider to retry paid but unfinished fulfillment then commits once',async()=>{const f=fixture({orders:[baseOrder],renderFail:true});f.completed();const event={id:'EVRENDERRETRY',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:captureFor(baseOrder)};const first=await f.request('webhook',event,null,f.webhookHeaders);assert.equal(first.status,503);assert.equal(first.body.code,'retry_fulfillment');assert.equal(f.state.orders[0].status,'paid');assert.equal(f.state.orders[0].result,null);assert.equal((await f.request('webhook',event,null,f.webhookHeaders)).status,200);assert.equal((await f.request('webhook',event,null,f.webhookHeaders)).status,200);assert.equal(f.state.fulfillmentWrites,1);assert.equal(f.state.captureCount,0);});
test('webhook render racing refund acknowledges revocation rather than retrying delivery',async()=>{const f=fixture({orders:[baseOrder],refundWhileRender:true});f.completed();const event={id:'EVREFUNDRACE',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:captureFor(baseOrder)};assert.equal((await f.request('webhook',event,null,f.webhookHeaders)).status,200);assert.equal(f.state.orders[0].status,'refunded');assert.equal(f.state.fulfillmentWrites,0);});

test('production TW cannot create, redirect or capture with any live/test environment flag',async()=>{const f=fixture({productionPolicy:true,orders:[baseOrder]});const c=await f.request('catalog');const tw=c.body.products.find(p=>p.market==='tw'&&p.sku==='arcana_3');assert.equal(tw.provider,'unconfigured');assert.equal(tw.providerAvailable,false);assert.equal(tw.checkoutAvailable,false);assert.equal((await f.request('create',createBody)).status,503);assert.equal((await f.request('capture',{reference:baseOrder.id})).status,503);const resume=await f.request('resume',{reference:baseOrder.id});assert.equal(resume.body.approvalUrl,undefined);assert.equal(f.state.captureCount,0);assert.equal(f.state.createCount,0);});

test('atomic DB pending-order cap maps to retry-existing guidance and no provider create',async()=>{const f=fixture({pendingLimit:true});const r=await f.request('create',createBody);assert.equal(r.status,429);assert.equal(r.body.code,'pending_checkout_limit');assert.equal(f.state.createCount,0);});
