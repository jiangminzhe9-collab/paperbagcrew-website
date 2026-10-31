/* Dedicated ARCANA session adapter. Does not run the homepage redirect or wallpaper code. */
(()=>{'use strict';
 const base='https://yliacgixfhjhgjemvbpg.supabase.co';
 const key='sb_publishable_MTi1uzs0XQMy9R6CfAYVHQ_5TDgjltp';
 let client;
 function getClient(){if(!client){if(!window.supabase)throw new Error('AUTH_UNAVAILABLE');client=window.supabase.createClient(base,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});}return client;}
 async function session(){const {data,error}=await getClient().auth.getSession();if(error)throw new Error('AUTH_REQUIRED');return data.session;}
 async function request(path,body,publicAccess=false){
  const s=await session();if(!publicAccess&&!s?.access_token)throw new Error('AUTH_REQUIRED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{const res=await fetch(base+'/functions/v1/arcana-service/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,...(s?.access_token?{Authorization:'Bearer '+s.access_token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok){const known=['pending_checkout_limit','old_uncertain_order','payment_review'];const error=new Error(known.includes(data.code)?data.code:res.status===401?'AUTH_REQUIRED':res.status===403?'NOT_ALLOWED':res.status===429?'TRY_LATER':'REQUEST_FAILED');error.status=res.status;throw error;}return data;}finally{clearTimeout(timer);}
 }
 function subscribe(fn){let last;const update=s=>{const token=s?.access_token||null;if(last===token)return;last=token;fn(s);};const {data}=getClient().auth.onAuthStateChange((event,s)=>{setTimeout(()=>update(event==='PASSWORD_RECOVERY'?null:s),0);});session().then(update).catch(()=>fn(null));return()=>data.subscription.unsubscribe();}
 window.ArcanaMember=Object.freeze({session,request,subscribe});
})();
