import {CATALOG,GLOBAL_CATALOG,providerForMarket as productionProviderForMarket,market,amountValue,ORIGIN,TERMS_VERSION,HttpError,closed,uuid,paypalId,exactKeys,productFor,assertLocal,buildPayPalOrder,validateOrder,captureState,approvalURL,publicOrder,validateResult} from './core.mjs';

// All external boundaries injected for offline tests. Production renderer is wired in index.ts.
export function createHandler(env,fetcher=fetch,{renderReading,validateQuestion,now=()=>Date.now(),providerForMarket=productionProviderForMarket}={}){
  const base=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY');
  const mode=env('ARCANA_PAYPAL_MODE')||'sandbox';
  const cfg={enabled:env('ARCANA_SERVICE_ENABLED')==='true',checkout:env('ARCANA_CHECKOUT_ENABLED')==='true',live:env('ARCANA_LIVE_CHECKOUT_ENABLED')==='true',client:env('ARCANA_PAYPAL_CLIENT_ID'),secret:env('ARCANA_PAYPAL_CLIENT_SECRET'),merchant:env('ARCANA_PAYPAL_MERCHANT_ID'),webhook:env('ARCANA_PAYPAL_WEBHOOK_ID'),testUsers:(env('ARCANA_SANDBOX_USER_IDS')||'').split(',').map(v=>v.trim()).filter(Boolean)};
  const pp=mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  const runtimeReady=()=>!!(base&&service);
  const rendererReady=()=>typeof renderReading==='function'&&typeof validateQuestion==='function';
  const configured=()=>cfg.enabled&&runtimeReady()&&rendererReady();
  const paymentConfigured=()=>runtimeReady()&&['sandbox','live'].includes(mode)&&cfg.client&&cfg.secret&&cfg.merchant&&cfg.webhook&&(mode==='sandbox'||cfg.live);
  const eligible=user=>mode==='live'?cfg.live:mode==='sandbox'&&cfg.testUsers.includes(user?.id);
  const available=user=>!!(configured()&&paymentConfigured()&&cfg.checkout&&eligible(user));
  const internalHeaders={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
  async function jsonFetch(url,options={}){
    const response=await fetcher(url,{...options,signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error('Upstream request failed');e.httpStatus=response.status;e.details=data;throw e;}return data;
  }
  const db=(path,options={})=>jsonFetch(base+'/rest/v1/'+path,{...options,headers:{...internalHeaders,...options.headers}});
  async function rpc(name,args){
    let result;try{result=await db('rpc/'+name,{method:'POST',body:JSON.stringify(args)});}catch(e){
      if(e.details?.code==='P0001'&&e.details?.message==='arcana_pending_limit')throw new HttpError(429,'You have unfinished checkouts. Resume an existing order before starting another.','pending_checkout_limit');
      if(['23505','23514','22023','P0001'].includes(e.details?.code))throw new HttpError(409,'This request conflicts with a saved order. Resume the existing order or use a new request for a new purchase.','order_conflict');
      throw e;
    }
    const row=Array.isArray(result)?result[0]:result;
    if(!row?.id)throw new HttpError(502,'The order could not be confirmed. Resume it before starting another purchase.','save_unconfirmed');
    return assertLocal(row);
  }
  async function publicCatalog(user){
    const rows=runtimeReady()?await db('arcana_catalog?select=market,sku,currency,amount_minor,enabled,provider'):[];
    if(!Array.isArray(rows))throw new HttpError(502,'Catalog could not be confirmed.');
    const products=['global','tw'].flatMap(m=>Object.values(m==='global'?GLOBAL_CATALOG:CATALOG).map(p=>{
      const saved=rows.find(row=>row.market===m&&row.sku===p.sku);
      const enabled=!!(p.amountMinor!==null&&saved?.enabled===true&&saved.currency===p.currency&&saved.amount_minor===p.amountMinor);
      const provider=providerForMarket(m)||'unconfigured',providerAvailable=!!(provider==='paypal'&&saved?.provider==='paypal'&&paymentConfigured());
      return {...p,market:m,provider,providerAvailable,enabled,amountValue:amountValue(p.amountMinor,p.currency),checkoutAvailable:enabled&&providerAvailable&&available(user)};
    }));
    return {products,checkoutAvailable:products.some(p=>p.checkoutAvailable),dailyAvailable:!!configured(),sandbox:mode!=='live',dailyTimeZone:'Asia/Taipei',termsVersion:TERMS_VERSION};
  }
  async function userFor(req){
    const auth=req.headers.get('authorization')||'';
    if(!/^Bearer [^\s]+$/.test(auth)||auth.length>8192)throw new HttpError(401,'Sign in to your account.','sign_in_required');
    let user;try{user=await jsonFetch(base+'/auth/v1/user',{headers:{apikey:service,Authorization:auth}});}catch{throw new HttpError(401,'Sign in again to continue.','session_expired');}
    if(!user.id||user.is_anonymous!==false||!user.email_confirmed_at)throw new HttpError(403,'Use a verified, non-anonymous member account.','verified_member_required');
    uuid(user.id);return user;
  }
  async function paypal(path,method='GET',body,requestId){
    if(!paymentConfigured())throw new HttpError(503,'Payments are not configured. No new payment was requested.','payments_unavailable');
    const token=await jsonFetch(pp+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+btoa(cfg.client+':'+cfg.secret),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
    if(typeof token.access_token!=='string'||!token.access_token)throw new HttpError(502,'Payment service is unavailable.');
    return jsonFetch(pp+path,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',Prefer:'return=representation',...(requestId?{'PayPal-Request-Id':requestId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function lookup(reference,user){
    const rows=await db('arcana_orders?id=eq.'+uuid(reference)+(user?'&user_id=eq.'+uuid(user.id):'')+'&select=*');
    if(!rows[0]||(user&&rows[0].user_id!==user.id))throw new HttpError(404,'Order not found for this account.','not_found');
    const order=assertLocal(rows[0]);
    if(order.sku!=='daily'&&order.environment!==mode)throw new HttpError(404,'Order is not in this payment environment.','not_found');
    return order;
  }
  async function findPayPal(id){
    const rows=await db('arcana_orders?provider_order_id=eq.'+paypalId(id)+'&environment=eq.'+mode+'&select=*');
    return rows[0]?assertLocal(rows[0]):null;
  }
  async function record(order,capture,state,eventId){
    return rpc('record_arcana_payment',{p_order:order.id,p_provider:'paypal',p_event_id:eventId,p_provider_order:order.provider_order_id,p_capture:capture?.id||null,p_state:state,p_merchant_id:cfg.merchant,p_amount_minor:order.amount_minor,p_currency:order.currency});
  }
  async function fulfill(order){
    if(order.status!=='paid'||order.result)return order;
    // The immutable DB draw_seed makes concurrent retries identical; SQL commits exactly once.
    try{const result=validateResult(await renderReading(order),order);return await rpc('fulfill_arcana_order',{p_order:order.id,p_result:result});}
    catch{
      // A refund may have raced rendering. Always reread authoritative state before returning.
      return lookup(order.id);
    }
  }
  async function remoteState(order,allowCapture=false){
    if(allowCapture&&providerForMarket(order.market)!=='paypal')throw new HttpError(503,'Payment for this market is not configured.','provider_unavailable');
    if(!order.provider_order_id)return {order,remote:null,capture:null,state:null};
    let remote=await paypal('/v2/checkout/orders/'+paypalId(order.provider_order_id));
    validateOrder(remote,order,cfg.merchant);
    if(allowCapture&&remote.status==='APPROVED'&&!closed(order.status)&&order.status!=='paid'){
      try{await paypal('/v2/checkout/orders/'+order.provider_order_id+'/capture','POST',{},'capture-'+order.id);}
      catch(e){if(e.details?.details?.some(d=>d.issue==='INSTRUMENT_DECLINED'))throw new HttpError(409,'Payment was declined. Choose another funding method in PayPal.','payment_declined');}
      // A lost response is not proof of failed capture. Never create a second payment.
      remote=await paypal('/v2/checkout/orders/'+order.provider_order_id);
    }
    const unit=validateOrder(remote,order,cfg.merchant),captures=unit.payments?.captures||[];
    if(captures.length>1)throw new HttpError(409,'Multiple captures need review. Do not pay again.','payment_review');
    if(captures.length){
      const capture=await paypal('/v2/payments/captures/'+paypalId(captures[0].id));
      if(capture.id!==captures[0].id||(order.provider_capture_id&&order.provider_capture_id!==capture.id))throw new HttpError(409,'Capture reference mismatch.','payment_mismatch');
      return {order,remote,capture,state:captureState(capture,order)};
    }
    const state=remote.status==='VOIDED'?'voided':remote.status==='APPROVED'?'approved':null;
    return {order,remote,capture:null,state};
  }
  async function reconcile(order,allowCapture=false){
    if(closed(order.status))return {order,remote:null};
    const r=await remoteState(order,allowCapture);
    if(r.state)r.order=await record(order,r.capture,r.state,'poll:'+order.provider_order_id+':'+(r.capture?.id||'none')+':'+r.state);
    r.order=await fulfill(r.order);return r;
  }
  async function ensureCreated(order){
    if(closed(order.status))return {order,remote:null};
    if(order.provider_order_id)return reconcile(order,false);
    if(providerForMarket(order.market)!=='paypal')throw new HttpError(503,'Payment for this market is not configured.','provider_unavailable');
    // PayPal's idempotency retention is bounded. Never recreate an uncertain old request.
    if(now()-Date.parse(order.created_at)>5*60*60*1000||!Number.isFinite(Date.parse(order.created_at)))throw new HttpError(409,'This unfinished checkout needs review before retrying. Do not start another payment for it.','old_uncertain_order');
    const remote=await paypal('/v2/checkout/orders','POST',buildPayPalOrder(order,cfg.merchant,mode),'create-'+order.id);
    paypalId(remote.id);validateOrder(remote,{...order,provider:'paypal',provider_order_id:remote.id},cfg.merchant);
    order=await rpc('bind_arcana_payment',{p_order:order.id,p_provider:'paypal',p_provider_order:remote.id,p_merchant_id:cfg.merchant});
    return {order,remote};
  }
  const withApproval=({order,remote})=>({...publicOrder(order),...(providerForMarket(order.market)==='paypal'&&!closed(order.status)&&!['paid','pending'].includes(order.status)&&remote?{approvalUrl:approvalURL(remote,mode)}:{})});
  function captureLink(resource){
    return resource?.supplementary_data?.related_ids?.capture_id||(resource?.links||[]).map(l=>l.href?.match(/^https:\/\/api(?:-m)?\.(?:sandbox\.)?paypal\.com\/v2\/payments\/captures\/([A-Z0-9]+)$/)?.[1]).find(Boolean);
  }
  async function webhook(req){
    if(!paymentConfigured())throw new HttpError(503,'Webhook is not configured.','payments_unavailable');
    const event=await readBody(req),fields={auth_algo:'paypal-auth-algo',cert_url:'paypal-cert-url',transmission_id:'paypal-transmission-id',transmission_sig:'paypal-transmission-sig',transmission_time:'paypal-transmission-time'};
    const verification={webhook_id:cfg.webhook,webhook_event:event};
    for(const [field,header]of Object.entries(fields)){verification[field]=req.headers.get(header);if(!verification[field])throw new HttpError(400,'Missing webhook signature.','missing_signature');}
    const verified=await paypal('/v1/notifications/verify-webhook-signature','POST',verification);
    if(verified.verification_status!=='SUCCESS')throw new HttpError(401,'Invalid webhook signature.','invalid_signature');
    if(typeof event.id!=='string'||!/^[A-Za-z0-9._:-]{1,150}$/.test(event.id))throw new HttpError(400,'Invalid event reference.');
    const supported=['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'];
    if(!supported.includes(event.event_type))return {received:true};
    const resource=event.resource||{},isRefund=event.event_type==='PAYMENT.CAPTURE.REFUNDED',isReversal=event.event_type==='PAYMENT.CAPTURE.REVERSED';
    let orderId=event.event_type==='CHECKOUT.ORDER.APPROVED'?resource.id:resource.supplementary_data?.related_ids?.order_id;
    let captureId=captureLink(resource)||(!isRefund&&event.event_type.startsWith('PAYMENT.CAPTURE.')?resource.id:null);
    let order;
    if(orderId){
      paypalId(orderId);order=await findPayPal(orderId);
      if(!order){
        // Recover the narrow create-succeeded/bind-failed race using server-owned custom_id.
        const remote=await paypal('/v2/checkout/orders/'+orderId);
        const ref=remote.purchase_units?.[0]?.custom_id;
        try{uuid(ref);}catch{return {received:true};}
        try{order=await lookup(ref);}catch(e){if(e.status===404)return {received:true};throw e;}
        if(order.sku==='daily'||order.environment!==mode)throw new HttpError(409,'Payment order mismatch.');
        validateOrder(remote,{...order,provider:'paypal',provider_order_id:orderId},cfg.merchant);
        order=await rpc('bind_arcana_payment',{p_order:order.id,p_provider:'paypal',p_provider_order:orderId,p_merchant_id:cfg.merchant});
      }
    }else{
      if(!captureId&&isRefund){const refund=await paypal('/v2/payments/refunds/'+paypalId(resource.id));captureId=captureLink(refund);}
      paypalId(captureId);
      const rows=await db('arcana_orders?provider_capture_id=eq.'+captureId+'&environment=eq.'+mode+'&select=*');
      if(!rows[0])throw new HttpError(503,'Capture binding is not ready. Retry webhook delivery.','retry_webhook');
      order=assertLocal(rows[0]);
    }
    // Fetch canonical order+capture; never treat event status alone as paid entitlement.
    const r=await remoteState(order,event.event_type==='CHECKOUT.ORDER.APPROVED');
    if(captureId&&r.capture?.id!==captureId)throw new HttpError(409,'Webhook capture mismatch.','payment_mismatch');
    if(isRefund||isReversal){
      if(!r.capture)throw new HttpError(503,'Capture is not ready. Retry webhook delivery.','retry_webhook');
      if(isRefund){
        const refund=await paypal('/v2/payments/refunds/'+paypalId(resource.id));
        if(refund.id!==resource.id||captureLink(refund)!==r.capture.id||refund.status!=='COMPLETED'||refund.amount?.currency_code!==order.currency||!(order.currency==='TWD'?/^[1-9][0-9]*$/:/^(?:0|[1-9][0-9]*)\.[0-9]{2}$/).test(refund.amount?.value||'')||Number(refund.amount.value)<=0||Number(refund.amount.value)>Number(amountValue(order.amount_minor,order.currency)))throw new HttpError(409,'Refund details could not be verified.','payment_mismatch');
      }else if(resource.id!==r.capture.id)throw new HttpError(409,'Reversal reference mismatch.','payment_mismatch');
      // Revoke FIRST, even if the capture GET is stale COMPLETED; terminal DB state never reopens.
      await record(order,r.capture,isRefund?'refunded':'reversed',event.id);
    }else{
      if(r.state){
        order=await record(order,r.capture,r.state,event.id+':'+r.state);order=await fulfill(order);
        // Non-2xx asks PayPal to redeliver after transient rendering/storage failure.
        // fulfill() rereads on failure: a concurrent revocation must not trigger fulfillment.
        if(order.status==='paid'&&!order.result)throw new HttpError(503,'Payment is saved; retry delivery to finish the reading.','retry_fulfillment');
      }
    }
    return {received:true};
  }
  async function readBody(req){
    const limit=65536;
    if(Number(req.headers.get('content-length')||0)>limit)throw new HttpError(413,'Request too large.');
    // Count raw bytes while reading, including requests with no Content-Length.
    const reader=req.body?.getReader(),chunks=[];let size=0;
    if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new HttpError(413,'Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    let value;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(text||'{}');}catch{throw new HttpError(400,'Invalid JSON.');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Invalid request.');return value;
  }
  function question(input,sku){try{return validateQuestion(input,sku);}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Choose a valid question and complete its options.','invalid_question');}}
  return async req=>{
    const origin=req.headers.get('origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(origin&&origin!==ORIGIN)return respond({error:'Origin not allowed.',code:'origin_denied'},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    try{
      const path=new URL(req.url).pathname.split('/').filter(Boolean).pop();
      if(path==='catalog'&&req.method==='GET'){
        let user=null;if(runtimeReady()&&req.headers.has('authorization'))user=await userFor(req);
        return respond(await publicCatalog(user));
      }
      // Pausing new service/checkout must not strand existing captures or refund webhooks.
      if(path==='webhook'&&req.method==='POST')return respond(await webhook(req));
      if(!runtimeReady()||(!['history','status','capture','resume'].includes(path)&&!configured()))throw new HttpError(503,'Readings are not open yet. No payment has been requested.','service_unavailable');
      const user=await userFor(req);
      if(path==='history'&&req.method==='GET'){
        const rows=await db('arcana_orders?user_id=eq.'+user.id+'&order=created_at.desc&limit=50&select=*');
        return respond({orders:rows.filter(r=>r.user_id===user.id&&(r.environment==='internal'||r.environment===mode)).map(publicOrder)});
      }
      if(req.method!=='POST')throw new HttpError(405,'Method not allowed.');
      const body=await readBody(req);
      if(path==='daily'){
        exactKeys(body,['question','market']);market(body.market);
        let order=await rpc('reserve_arcana_daily',{p_user:user.id,p_question:question(body.question,'daily'),p_market:body.market});
        order=await fulfill(order);return respond(publicOrder(order));
      }
      if(path==='create'){
        exactKeys(body,['sku','requestKey','question','termsVersion','market']);const p=productFor(body.sku,market(body.market));uuid(body.requestKey);if(p.amountMinor===null)throw new HttpError(503,'Pricing for this market is not open yet.','market_unavailable');
        if(body.termsVersion!==TERMS_VERSION)throw new HttpError(400,'Review the current reading terms first.','terms_required');
        const q=question(body.question,body.sku);
        if(!available(user)||(await publicCatalog(user)).products.find(p=>p.sku===body.sku&&p.market===body.market)?.checkoutAvailable!==true)throw new HttpError(503,'Checkout is not open for this account or product. No payment has been requested.','checkout_unavailable');
        const order=await rpc('reserve_arcana_order',{p_user:user.id,p_request_key:body.requestKey,p_sku:body.sku,p_environment:mode,p_question:q,p_market:body.market});
        return respond(withApproval(await ensureCreated(order)));
      }
      if(['status','capture','resume'].includes(path)){
        exactKeys(body,['reference']);let order=await lookup(body.reference,user);
        if(order.sku==='daily')return respond(publicOrder(await fulfill(order)));
        if(!eligible(user))throw new HttpError(403,'This payment environment is not available for this account.','environment_denied');
        if(closed(order.status))return respond(publicOrder(order));
        if(path==='resume'){if(!order.provider_order_id&&(!available(user)||(await publicCatalog(user)).products.find(p=>p.sku===order.sku&&p.market===order.market)?.checkoutAvailable!==true))throw new HttpError(503,'New checkout is paused. Keep this reference and retry later.','checkout_unavailable');return respond(withApproval(await ensureCreated(order)));}
        const result=await reconcile(order,path==='capture');return respond(publicOrder(result.order));
      }
      throw new HttpError(404,'Not found.','not_found');
    }catch(e){
      // Do not log JWTs, question text, provider payloads, payer data or secrets.
      return respond({error:e instanceof HttpError?e.message:'We could not confirm the request. Resume this order before paying again.',code:e instanceof HttpError?e.code:'upstream_unconfirmed'},e instanceof HttpError?e.status:502);
    }
  };
}
