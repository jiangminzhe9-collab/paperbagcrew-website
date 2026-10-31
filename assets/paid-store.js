(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const checkout=Boolean($('checkout-status'));
  const status=checkout?$('checkout-status'):$('purchases-status');
  if(!status)return;
  if(!window.supabase){status.textContent='Account services could not load. Please refresh.';return;}
  const base='https://yliacgixfhjhgjemvbpg.supabase.co';
  const key='sb_publishable_MTi1uzs0XQMy9R6CfAYVHQ_5TDgjltp';
  const client=window.paperbagMemberClient||window.supabase.createClient(base,key);
  const endpoint=base+'/functions/v1/paperbag-payments/';
  const sku='city-sessions-vol-01';
  let session=null,busy=false,version=0,orderId=new URLSearchParams(location.search).get('token');
  const cancelled=new URLSearchParams(location.search).has('cancelled');
  const say=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
  async function api(path,body) {
    const {data,error}=await client.auth.getSession();
    if(error)throw new Error('Please sign in again.');
    const token=data.session?.access_token;
    const res=await fetch(endpoint+path,{method:body?'POST':'GET',headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
    const value=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(value.error||'Could not confirm this request. Please try again.');
    return value;
  }
  async function download(button) {
    if(busy)return;
    busy=true;button.disabled=true;say('Preparing your ZIP download…');
    const current=version;
    try {
      const data=await api('download',{sku});
      if(current!==version)return;
      const url=new URL(data.url);
      if(url.origin!==base||!url.pathname.startsWith('/storage/v1/object/sign/paid-downloads/'))throw new Error('Invalid download link.');
      const link=document.createElement('a');link.href=url.href;link.textContent='Download City Sessions ZIP';link.rel='noopener noreferrer';
      status.replaceChildren(link);
      link.click();
      // Keep the user-triggered fallback available when a mobile browser blocks auto-download.
    } catch(error){if(current===version)say(error.message,true);}
    finally{busy=false;button.disabled=false;}
  }
  function paidState(data) {
    if(data.orderId)orderId=data.orderId;
    $('buy-button').hidden=!['creating','created'].includes(data.status);
    $('download-collection').hidden=data.status!=='paid';
    $('check-payment').hidden=['refunded','reversed','declined','voided'].includes(data.status);
    const messages={paid:'Payment confirmed. Your complete collection is ready to download.',pending:'PayPal is still processing your payment. You can return to My purchases later; do not pay again.',created:'Payment has not been confirmed. Use Check payment to refresh your order.',creating:'Your checkout is being prepared.',refunded:'This payment was refunded. Download access for this order is closed.',reversed:'This payment was reversed. Contact support if you need help.',declined:'This payment was declined. No download has been unlocked.',voided:'This checkout has expired. Return to the collection to start again.'};
    say((data.sandbox?'TEST MODE · ':'')+(messages[data.status]||'Payment is being verified. Please check again later.'));
    if(data.status==='paid')$('check-payment').hidden=true;
  }
  async function checkPayment(capture) {
    if(!orderId||busy)return;
    busy=true;$('check-payment').disabled=true;
    say('Checking your payment with PayPal…');
    const current=version;
    try{const data=await api(capture?'capture':'status',{orderId});if(current===version)paidState(data);}
    catch(error){if(current===version){say(error.message,true);$('check-payment').hidden=false;}}
    finally{busy=false;$('check-payment').disabled=false;}
  }
  async function render(next) {
    session=next;const current=++version;
    if(checkout) {
      $('buy-button').hidden=true;$('download-collection').hidden=true;$('check-payment').hidden=true;
      $('signin-needed').hidden=!!session;
      if(!session){say(orderId?'Sign in to the account used for this purchase to confirm payment.':'Sign in to save purchases and download them again.');return;}
      if(orderId){await checkPayment(!cancelled);return;}
      try {
        const {data,error}=await client.from('commerce_orders').select('paypal_order_id,status,environment').eq('sku',sku).in('status',['paid','pending','created','creating']).order('created_at',{ascending:false});
        if(error)throw new Error('Your purchases could not load. Please refresh.');
        if(current!==version)return;
        const config=await api('catalog');
        if(current!==version)return;
        const existing=(data||[]).find(x=>x.environment==='live'||(config.sandbox&&config.available));
        if(existing?.status==='paid'){paidState({status:'paid',orderId:existing.paypal_order_id,sandbox:existing.environment==='sandbox'});return;}
        if(existing?.paypal_order_id){orderId=existing.paypal_order_id;$('check-payment').hidden=false;}
        $('buy-button').hidden=!config.available;
        $('buy-button').textContent=config.sandbox?'Test PayPal checkout':'Continue to PayPal · US$4.99';
        say(config.available?(config.sandbox?'Sandbox test: no real payment.':'One-time purchase · US$4.99. Review the terms below before continuing.'):'Checkout is being prepared. Purchases are not open yet.');
        if(cancelled)say('You left PayPal checkout. No download is unlocked until payment is confirmed.');
      }catch(error){if(current===version)say(error.message,true);}
    }else{
      $('purchases').hidden=!session;
      $('purchases-list').replaceChildren();
      if(!session)return;
      say('Loading your purchases…');
      const {data,error}=await client.from('commerce_orders').select('id,sku,status,environment,created_at,paypal_order_id').order('created_at',{ascending:false}).limit(50);
      if(current!==version)return;
      if(error){say('Purchases could not load. Use Refresh purchases to try again.',true);return;}
      if(!data.length){say('No purchases yet. Your six free wallpaper choices are separate from paid collections.');return;}
      say('Downloads become available after payment is confirmed.');
      for(const order of data){
        if(order.sku!==sku)continue;
        const card=document.createElement('div');card.className='notice';
        const title=document.createElement('h3');title.textContent='City Sessions Vol. 01'+(order.environment==='sandbox'?' · Test order':'');
        const detail=document.createElement('p');detail.textContent='Status: '+order.status+' · '+new Date(order.created_at).toLocaleDateString();
        card.append(title,detail);
        if(order.status==='paid'){
          const button=document.createElement('button');button.type='button';button.textContent='Download complete ZIP';button.onclick=()=>download(button);card.append(button);
        }else if(['creating','created','pending'].includes(order.status)){
          const link=document.createElement('a');link.className='button';link.href='/shop/city-sessions-vol-01/checkout/'+(order.paypal_order_id?'?token='+encodeURIComponent(order.paypal_order_id):'');link.textContent='Check / resume purchase';card.append(link);
        }
        const ref=document.createElement('p');ref.className='muted';ref.textContent='Order reference: '+order.id;card.append(ref);
        $('purchases-list').append(card);
      }
    }
  }
  if(checkout){
    $('buy-button').onclick=async()=>{
      if(busy)return;
      if(!$('accept-terms').checked){say('Please read and accept the personal-use terms.',true);$('accept-terms').focus();return;}
      busy=true;$('buy-button').disabled=true;say('Preparing your secure PayPal checkout…');
      const current=version;
      try{
        const data=await api('create',{sku,termsVersion:'2026-10-31'});
        if(current!==version)return;
        if(data.approvalUrl){const url=new URL(data.approvalUrl);if(url.protocol!=='https:'||!['www.paypal.com','www.sandbox.paypal.com'].includes(url.hostname)||url.port)throw new Error('Invalid PayPal checkout link.');location.assign(url.href);}
        else paidState(data);
      }catch(error){if(current===version)say(error.message,true);}
      finally{busy=false;$('buy-button').disabled=false;}
    };
    $('check-payment').onclick=()=>checkPayment(true);
    $('download-collection').onclick=()=>download($('download-collection'));
  }else $('purchases-refresh').onclick=()=>render(session);
  let lastToken;
  client.auth.onAuthStateChange((event,value)=>{
    if(lastToken===value?.access_token)return;
    lastToken=value?.access_token;
    setTimeout(()=>render(event==='PASSWORD_RECOVERY'?null:value),0);
  });
  client.auth.getSession().then(({data,error})=>{if(error)say('Please sign in again.',true);else if(lastToken===undefined){lastToken=data.session?.access_token;render(data.session);}});
})();
