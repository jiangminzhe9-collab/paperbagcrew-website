import {SKU,ORIGIN,HttpError,assertPayPalId,canCheckout,buildPayPalOrder,validateOrder,captureState,approvalURL,canDownload} from './core.mjs';

// Dependency injection keeps the HTTP/payment boundaries testable without real charges.
export function createHandler(env, fetcher=fetch) {
  const base=env('SUPABASE_URL');
  const service=env('SUPABASE_SERVICE_ROLE_KEY');
  const mode=env('PAYPAL_MODE')||'sandbox';
  const config={mode,clientId:env('PAYPAL_CLIENT_ID'),secret:env('PAYPAL_CLIENT_SECRET'),merchantId:env('PAYPAL_MERCHANT_ID'),webhookId:env('PAYPAL_WEBHOOK_ID'),
    liveEnabled:env('PBC_LIVE_CHECKOUT_ENABLED')==='true',testUsers:(env('PAYPAL_SANDBOX_USER_IDS')||'').split(',').map(x=>x.trim()).filter(Boolean)};
  const pp=mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  const internalHeaders={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
  async function jsonFetch(url,options={}) {
    const r=await fetcher(url,{...options,signal:AbortSignal.timeout(20000)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) { const error=new Error('Upstream request failed'); error.httpStatus=r.status; error.details=data; throw error; }
    return data;
  }
  const db=(path,options={})=>jsonFetch(base+'/rest/v1/'+path,{...options,headers:{...internalHeaders,...options.headers}});
  const rpc=async(name,args)=>{
    const data=await db('rpc/'+name,{method:'POST',headers:{Accept:'application/vnd.pgrst.object+json'},body:JSON.stringify(args)});
    const row=Array.isArray(data)&&data.length===1?data[0]:data;
    if(!row?.id)throw new HttpError(502,'Order could not be saved. Check My purchases before retrying.');
    return row;
  };
  async function userFor(req) {
    const auth=req.headers.get('authorization')||'';
    if(!auth.startsWith('Bearer ')||auth.length>8192) throw new HttpError(401,'Please sign in to your Paperbag Crew account.');
    let user;
    try {user=await jsonFetch(base+'/auth/v1/user',{headers:{apikey:service,Authorization:auth}});} catch {throw new HttpError(401,'Your session expired. Please sign in again.');}
    if(!user.id||user.is_anonymous||!user.email_confirmed_at) throw new HttpError(403,'Verify your account email before buying.');
    return user;
  }
  async function product() {
    const data=await db('commerce_products?sku=eq.'+SKU+'&select=*');
    if(!data[0]) throw new HttpError(503,'This collection is not available yet.');
    return data[0];
  }
  async function paypal(path,method='GET',body,requestId) {
    if(!config.clientId||!config.secret||!config.merchantId) throw new HttpError(503,'PayPal checkout is not open yet.');
    const token=await jsonFetch(pp+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+btoa(config.clientId+':'+config.secret),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
    return jsonFetch(pp+path,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',Prefer:'return=representation',...(requestId?{'PayPal-Request-Id':requestId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function lookup(id,user) {
    assertPayPalId(id);
    const rows=await db('commerce_orders?paypal_order_id=eq.'+id+(user?'&user_id=eq.'+encodeURIComponent(user.id):'')+'&select=*');
    if(!rows[0]||rows[0].environment!==mode) throw new HttpError(404,'Order not found for this account.');
    return rows[0];
  }
  async function reconcile(local,allowCapture=false) {
    let remote=await paypal('/v2/checkout/orders/'+assertPayPalId(local.paypal_order_id));
    validateOrder(remote,local,config.merchantId);
    if(allowCapture&&remote.status==='APPROVED'&&!['paid','refunded','reversed'].includes(local.status)) {
      try {await paypal('/v2/checkout/orders/'+local.paypal_order_id+'/capture','POST',{},'capture-'+local.id);}
      catch(error) {
        // A timeout or duplicate capture may have succeeded; verify the order again.
        if(error.details?.details?.some(x=>x.issue==='INSTRUMENT_DECLINED')) throw new HttpError(409,'PayPal declined this payment. Choose another funding method in PayPal.');
      }
      remote=await paypal('/v2/checkout/orders/'+local.paypal_order_id);
    }
    const unit=validateOrder(remote,local,config.merchantId);
    const captures=unit.payments?.captures||[];
    if(captures.length>1) throw new HttpError(409,'Payment needs review. Contact support with your order reference.');
    if(captures.length===1) {
      // Fresh capture details prevent a delayed webhook from restoring refunded access.
      const capture=await paypal('/v2/payments/captures/'+assertPayPalId(captures[0].id));
      if(capture.id!==captures[0].id) throw new HttpError(409,'Capture reference mismatch.');
      const state=captureState(capture,local);
      local=await rpc('record_commerce_payment',{p_order:local.id,p_capture:capture.id,p_state:state});
    } else if(remote.status==='VOIDED') {
      const rows=await db('commerce_orders?id=eq.'+local.id+'&status=in.(creating,created)',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'voided',updated_at:new Date().toISOString()})});
      if(rows[0]) local=rows[0];
    }
    return {local,remote};
  }
  async function webhook(req) {
    if(!config.webhookId) throw new HttpError(503,'Webhook is not configured.');
    const body=await readBody(req);
    const fields={'auth_algo':'paypal-auth-algo','cert_url':'paypal-cert-url','transmission_id':'paypal-transmission-id','transmission_sig':'paypal-transmission-sig','transmission_time':'paypal-transmission-time'};
    const verify={webhook_id:config.webhookId,webhook_event:body};
    for(const [field,header] of Object.entries(fields)) {
      verify[field]=req.headers.get(header);
      if(!verify[field]) throw new HttpError(400,'Missing webhook signature.');
    }
    const verified=await paypal('/v1/notifications/verify-webhook-signature','POST',verify);
    if(verified.verification_status!=='SUCCESS') throw new HttpError(401,'Invalid webhook signature.');
    const supported=['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'];
    if(!supported.includes(body.event_type)) return {received:true};
    const resource=body.resource||{};
    let id=body.event_type==='CHECKOUT.ORDER.APPROVED'?resource.id:resource.supplementary_data?.related_ids?.order_id;
    let local;
    if(id) {
      try {local=await lookup(id);} catch(e) {
        if(e.status!==404)throw e;
        // Recover the narrow race where PayPal created the order but saving its ID failed.
        const remote=await paypal('/v2/checkout/orders/'+assertPayPalId(id));
        const reference=remote.purchase_units?.[0]?.custom_id;
        if(typeof reference!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference))return {received:true};
        const rows=await db('commerce_orders?id=eq.'+encodeURIComponent(reference)+'&environment=eq.'+mode+'&select=*');
        if(!rows[0])return {received:true};
        local=rows[0];
        if(local.paypal_order_id&&local.paypal_order_id!==id)throw new HttpError(409,'Order reference mismatch.');
        validateOrder(remote,{...local,paypal_order_id:id},config.merchantId);
        await db('commerce_orders?id=eq.'+local.id+'&paypal_order_id=is.null',{method:'PATCH',body:JSON.stringify({paypal_order_id:id,status:'created',updated_at:new Date().toISOString()})});
        local={...local,paypal_order_id:id};
      }
    } else {
      const captureId=resource.supplementary_data?.related_ids?.capture_id||
        (resource.links||[]).map(x=>x.href?.match(/^https:\/\/api(?:-m)?\.(?:sandbox\.)?paypal\.com\/v2\/payments\/captures\/([A-Z0-9]+)$/)?.[1]).find(Boolean)||resource.id;
      assertPayPalId(captureId);
      const rows=await db('commerce_orders?paypal_capture_id=eq.'+captureId+'&environment=eq.'+mode+'&select=*');
      local=rows[0];
      if(!local) throw new HttpError(503,'Capture has not been reconciled yet. Retry delivery.');
    }
    const reconciled=await reconcile(local,body.event_type==='CHECKOUT.ORDER.APPROVED');
    // A verified refund/reversal closes access even while capture GET is catching up.
    if(['PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'].includes(body.event_type)&&reconciled.local.paypal_capture_id) {
      await rpc('record_commerce_payment',{p_order:local.id,p_capture:reconciled.local.paypal_capture_id,p_state:body.event_type.endsWith('REFUNDED')?'refunded':'reversed'});
    }
    if(typeof body.id!=='string'||body.id.length>150) throw new HttpError(400,'Invalid event reference.');
    await db('commerce_webhook_events?on_conflict=event_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({event_id:body.id,event_type:body.event_type,order_id:local.id})});
    return {received:true};
  }
  async function readBody(req) {
    if(Number(req.headers.get('content-length')||0)>65536) throw new HttpError(413,'Request too large.');
    const text=await req.text();
    if(text.length>65536) throw new HttpError(413,'Request too large.');
    try {const v=JSON.parse(text||'{}');if(!v||Array.isArray(v)||typeof v!=='object')throw new Error();return v;} catch {throw new HttpError(400,'Invalid request.');}
  }
  return async req=>{
    const origin=req.headers.get('origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
    const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(origin&&origin!==ORIGIN) return respond({error:'Origin not allowed.'},403);
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    try {
      const path=new URL(req.url).pathname.split('/').pop();
      if(path==='webhook'&&req.method==='POST') return respond(await webhook(req));
      if(path==='catalog'&&req.method==='GET') {
        const p=await product();
        let user=null;
        if(req.headers.has('authorization')) user=await userFor(req);
        return respond({sku:SKU,title:p.title,amount:p.amount_cents,currency:p.currency,available:canCheckout(config,p,user),sandbox:mode==='sandbox'});
      }
      if(req.method!=='POST') throw new HttpError(405,'Method not allowed.');
      const user=await userFor(req),body=await readBody(req);
      if(path==='create') {
        const p=await product();
        if(body.sku!==SKU||body.termsVersion!=='2026-10-31') throw new HttpError(400,'Review the product and personal-use terms before continuing.');
        if(!canCheckout(config,p,user)) throw new HttpError(503,'Checkout is not open yet. No payment has been requested.');
        let local=await rpc('reserve_commerce_order',{p_user:user.id,p_sku:SKU,p_environment:mode});
        if(local.status==='paid') return respond({status:'paid',orderId:local.paypal_order_id});
        let remote;
        if(local.paypal_order_id) ({local,remote}=await reconcile(local,false));
        else {
          // Never recreate an uncertain old request after PayPal's idempotency window.
          if(Date.now()-Date.parse(local.created_at)>5*60*60*1000) throw new HttpError(409,'This checkout needs review before retrying. Contact support with your order reference.');
          remote=await paypal('/v2/checkout/orders','POST',buildPayPalOrder(local,p,config.merchantId),'create-'+local.id);
          assertPayPalId(remote.id);
          validateOrder(remote,{...local,paypal_order_id:remote.id},config.merchantId);
          await db('commerce_orders?id=eq.'+local.id+'&paypal_order_id=is.null',{method:'PATCH',body:JSON.stringify({paypal_order_id:remote.id,status:'created',updated_at:new Date().toISOString()})});
        }
        if(['paid','pending'].includes(local.status)) return respond({status:local.status,orderId:remote.id});
        if(['refunded','reversed','voided','declined'].includes(local.status)) throw new HttpError(409,'This order is closed. Refresh to start a new checkout.');
        return respond({status:'created',orderId:remote.id,approvalUrl:approvalURL(remote,mode)});
      }
      if(path==='capture'||path==='status') {
        const local=await lookup(body.orderId,user);
        if(mode==='sandbox'&&!config.testUsers.includes(user.id)) throw new HttpError(403,'Test access is unavailable.');
        // Existing approved orders can finish even if new checkout has been paused.
        const result=await reconcile(local,path==='capture');
        return respond({status:result.local.status,orderId:local.paypal_order_id,reference:local.id,sandbox:mode==='sandbox'});
      }
      if(path==='download') {
        if(body.sku!==SKU) throw new HttpError(400,'Unknown collection.');
        const rows=await db('commerce_orders?user_id=eq.'+encodeURIComponent(user.id)+'&sku=eq.'+SKU+'&status=eq.paid&order=created_at.desc&select=*');
        const order=rows.find(o=>canDownload(o,user,config));
        if(!order) throw new HttpError(403,'A completed purchase is required to download this collection.');
        const p=await product();
        const data=await jsonFetch(base+'/storage/v1/object/sign/'+p.bucket+'/'+p.object_path,{method:'POST',headers:internalHeaders,body:JSON.stringify({expiresIn:120})});
        const url=new URL(data.signedURL,base+'/storage/v1');
        // Storage returns a /object/sign/... relative path (or a full URL).
        if(data.signedURL?.startsWith('/object/')) url.href=base+'/storage/v1'+data.signedURL;
        if(url.origin!==new URL(base).origin||!url.pathname.startsWith('/storage/v1/object/sign/paid-downloads/')) throw new HttpError(502,'Download could not be prepared.');
        url.searchParams.set('download','Paperbag-Crew-City-Sessions-Vol-01.zip');
        return respond({url:url.href,expiresIn:120});
      }
      throw new HttpError(404,'Not found.');
    } catch(error) {
      // Never log tokens, payer data, webhook payloads, or upstream responses.
      if(!(error instanceof HttpError)) console.error('paperbag-payments upstream error',error.httpStatus||error.name||'unknown');
      return respond({error:error instanceof HttpError?error.message:'We could not confirm this request. Please retry from My purchases; do not pay again.'},error instanceof HttpError?error.status:502);
    }
  };
}
