export const SKU = 'city-sessions-vol-01';
export const ORIGIN = 'https://paperbagcrew.com';
export const RETURN_URL = ORIGIN + '/shop/city-sessions-vol-01/checkout/';
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function money(cents) { return (cents / 100).toFixed(2); }
export function assertPayPalId(id) {
  if (typeof id !== 'string' || !/^[A-Z0-9]{1,36}$/.test(id)) throw new HttpError(400,'Invalid order reference.');
  return id;
}
export function canCheckout(config, product, user) {
  if (!config.clientId || !config.secret || !config.merchantId || !config.webhookId || !product.file_ready) return false;
  if (config.mode === 'live') return config.liveEnabled === true && product.enabled === true;
  return config.mode === 'sandbox' && !!user && config.testUsers.includes(user.id);
}
export function buildPayPalOrder(order, product, merchantId) {
  return {
    intent:'CAPTURE',
    purchase_units:[{
      reference_id:order.sku, custom_id:order.id, invoice_id:order.id,
      description:'Paperbag Crew — ' + product.title,
      payee:{merchant_id:merchantId},
      amount:{currency_code:order.currency,value:money(order.amount_cents),breakdown:{item_total:{currency_code:order.currency,value:money(order.amount_cents)}}},
      items:[{name:product.title,sku:order.sku,quantity:'1',category:'DIGITAL_GOODS',unit_amount:{currency_code:order.currency,value:money(order.amount_cents)}}]
    }],
    payment_source:{paypal:{experience_context:{brand_name:'Paperbag Crew · DONGZE',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:RETURN_URL,cancel_url:RETURN_URL+'?cancelled=1'}}}
  };
}
export function validateOrder(remote, local, merchantId) {
  const unit=remote.purchase_units?.[0];
  if (remote.id !== local.paypal_order_id || remote.intent !== 'CAPTURE' || remote.purchase_units?.length !== 1 ||
      unit?.custom_id !== local.id || unit?.reference_id !== local.sku || unit?.invoice_id !== local.id ||
      unit?.payee?.merchant_id !== merchantId || unit?.amount?.currency_code !== local.currency ||
      unit?.amount?.value !== money(local.amount_cents)) throw new HttpError(409,'Payment details could not be verified. Contact support with your order reference.');
  return unit;
}
export function captureState(capture, local) {
  assertPayPalId(capture.id);
  if (capture.amount?.currency_code !== local.currency || capture.amount?.value !== money(local.amount_cents))
    throw new HttpError(409,'Payment amount could not be verified.');
  const states={COMPLETED:'paid',PENDING:'pending',DECLINED:'declined',DENIED:'declined',REFUNDED:'refunded',PARTIALLY_REFUNDED:'refunded',REVERSED:'reversed',FAILED:'declined'};
  if (!states[capture.status]) throw new HttpError(409,'Payment is still being verified. Please refresh later.');
  return states[capture.status];
}
export function approvalURL(remote, mode) {
  const link=remote.links?.find(x=>x.rel==='payer-action'||x.rel==='approve');
  if (!link) throw new HttpError(409,'This checkout cannot be resumed. Contact support with your order reference.');
  const url=new URL(link.href);
  const host=mode==='live'?'www.paypal.com':'www.sandbox.paypal.com';
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password)
    throw new HttpError(502,'Could not open PayPal checkout.');
  return url.href;
}
export function canDownload(order, user, config) {
  return order.user_id===user.id && order.status==='paid' &&
    (order.environment==='live'||(config.mode==='sandbox'&&config.testUsers.includes(user.id)));
}
