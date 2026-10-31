// Server-owned catalog. TWD is a zero-decimal PayPal currency: never divide by 100.
export const ORIGIN = 'https://paperbagcrew.com';
// Taiwan's local provider is not approved/configured. No environment flag enables TW PayPal.
export const providerForMarket = region => region==='global'?'paypal':null;
export const TERMS_VERSION = '2026-10-31';
export const CATALOG = Object.freeze({
  arcana_3:Object.freeze({sku:'arcana_3',amountMinor:299,currency:'TWD',cards:3,title:'DZ ARCANA · Three-card reading'}),
  arcana_5:Object.freeze({sku:'arcana_5',amountMinor:499,currency:'TWD',cards:5,title:'DZ ARCANA · Five-card reading'})
});
export class HttpError extends Error { constructor(status,message,code='request_failed'){super(message);this.status=status;this.code=code;} }
export const GLOBAL_CATALOG = Object.freeze(Object.fromEntries(Object.entries(CATALOG).map(([sku,p])=>[sku,Object.freeze({...p,currency:'USD',amountMinor:null})])));
export function market(value){if(!['tw','global'].includes(value))throw new HttpError(400,'Choose a market.','invalid_market');return value;}
export function amountValue(amount,currency){if(amount===null)return null;if(!Number.isSafeInteger(amount)||amount<0||!['TWD','USD'].includes(currency))throw new HttpError(409,'Invalid amount.');return currency==='USD'?(amount/100).toFixed(2):String(amount);}
export const closed = state => ['refunded','reversed','voided','declined'].includes(state);
export function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new HttpError(400,'Invalid reference.','invalid_reference');return value.toLowerCase();}
export function paypalId(value){if(typeof value!=='string'||!/^[A-Z0-9]{1,36}$/.test(value))throw new HttpError(400,'Invalid payment reference.','invalid_reference');return value;}
export function exactKeys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new HttpError(400,'Unexpected request fields.','invalid_request');}
export function productFor(sku,region='tw'){const catalog=market(region)==='global'?GLOBAL_CATALOG:CATALOG;const p=Object.hasOwn(catalog,sku)?catalog[sku]:null;if(!p)throw new HttpError(400,'Unknown reading.','invalid_product');return p;}
export function assertLocal(order){
  uuid(order?.id);uuid(order?.user_id);uuid(order?.draw_seed);market(order.market);
  if(order.provider_order_id&&order.provider!=='paypal')throw new HttpError(409,'Payment provider binding needs review.');
  if(order.sku==='daily'){if(order.environment!=='internal'||order.amount_minor!==0||order.currency!==(order.market==='global'?'USD':'TWD'))throw new HttpError(409,'Daily reading needs review.');}
  else {const p=productFor(order.sku,order.market);if(p.amountMinor===null||order.amount_minor!==p.amountMinor||order.currency!==p.currency||!['sandbox','live'].includes(order.environment))throw new HttpError(409,'Order details need review.');}
  return order;
}
export function buildPayPalOrder(order,merchantId,mode){
  const p=productFor(order.sku,order.market);assertLocal(order);
  const value=amountValue(p.amountMinor,p.currency),returnUrl=ORIGIN+'/arcana/readings/?reference='+uuid(order.id)+'&market='+market(order.market)+'&lang='+(order.question?.language==='zh'?'zh-Hant':'en');
  return {intent:'CAPTURE',purchase_units:[{reference_id:p.sku,custom_id:order.id,invoice_id:order.id,description:p.title,payee:{merchant_id:merchantId},amount:{currency_code:p.currency,value,breakdown:{item_total:{currency_code:p.currency,value}}},items:[{name:p.title,sku:p.sku,quantity:'1',category:'DIGITAL_GOODS',unit_amount:{currency_code:p.currency,value}}]}],payment_source:{paypal:{experience_context:{brand_name:'DZ ARCANA · Paperbag Crew',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:returnUrl,cancel_url:returnUrl+'&cancelled=1'}}}};
}
export function validateOrder(remote,local,merchantId){
  assertLocal(local);const unit=remote?.purchase_units?.[0];
  if(remote?.id!==local.provider_order_id||remote.intent!=='CAPTURE'||remote.purchase_units?.length!==1||unit?.reference_id!==local.sku||unit?.custom_id!==local.id||unit?.invoice_id!==local.id||unit?.payee?.merchant_id!==merchantId||unit?.amount?.currency_code!==local.currency||unit?.amount?.value!==amountValue(local.amount_minor,local.currency))throw new HttpError(409,'Payment details could not be verified.','payment_mismatch');
  return unit;
}
export function captureState(capture,local){
  paypalId(capture?.id);
  if(capture.amount?.currency_code!==local.currency||capture.amount?.value!==amountValue(local.amount_minor,local.currency)||capture.supplementary_data?.related_ids?.order_id!==local.provider_order_id|| (capture.invoice_id!==undefined&&capture.invoice_id!==local.id)|| (capture.custom_id!==undefined&&capture.custom_id!==local.id))throw new HttpError(409,'Payment capture could not be verified.','payment_mismatch');
  const states={COMPLETED:'paid',PENDING:'pending',DECLINED:'declined',DENIED:'declined',FAILED:'declined',REFUNDED:'refunded',PARTIALLY_REFUNDED:'refunded',REVERSED:'reversed'};
  if(!states[capture.status])throw new HttpError(409,'Payment is not yet confirmed.','payment_unconfirmed');
  return states[capture.status];
}
export function approvalURL(remote,mode){
  const href=remote.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;
  let url;try{url=new URL(href);}catch{throw new HttpError(409,'This checkout has no approval link.','approval_unavailable');}
  if(url.protocol!=='https:'||url.hostname!==(mode==='live'?'www.paypal.com':'www.sandbox.paypal.com')||url.port||url.username||url.password)throw new HttpError(502,'Checkout link could not be verified.','invalid_approval');
  return url.href;
}
export function publicOrder(order){
  const revoked=['refunded','reversed'].includes(order.status);
  return {reference:order.id,provider:order.provider||null,status:order.status,sku:order.sku,market:order.market,amountMinor:order.amount_minor,amountValue:amountValue(order.amount_minor,order.currency),currency:order.currency,question:order.question,createdAt:order.created_at,sandbox:order.environment==='sandbox',result:order.status==='paid'?(order.result||null):null,fulfillment:revoked?'revoked':order.status==='paid'?(order.result?'ready':'retryable'):'awaiting_payment'};
}
export function validateResult(result,order){
  const count=order.sku==='daily'?1:productFor(order.sku).cards;
  if(!result||typeof result!=='object'||!Array.isArray(result.cards)||result.cards.length!==count||new Set(result.cards.map(c=>c.id)).size!==count||result.cards.some(c=>!Number.isInteger(c.id)||c.id<0||c.id>77||typeof c.reversed!=='boolean')||!result.reading||typeof result.reading!=='object'||Array.isArray(result.reading)||typeof result.reading_version!=='string'||!result.reading_version||JSON.stringify(result).length>262144)throw new HttpError(503,'Reading preparation can be retried without paying again.','render_failed');
  return result;
}
