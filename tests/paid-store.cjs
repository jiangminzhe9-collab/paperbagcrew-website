const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(root+'/assets/paid-store.js','utf8');
const member={access_token:'member',user:{id:'buyer'}};
const tick=()=>new Promise(r=>setTimeout(r,30));
async function page({account=false,session=member,orders=[],available=false,status='paid',search=''}={}){
  const file=account?'account/index.html':'shop/city-sessions-vol-01/checkout/index.html';
  const dom=new JSDOM(fs.readFileSync(root+'/'+file,'utf8'),{url:'https://paperbagcrew.com/'+(account?'account/':'shop/city-sessions-vol-01/checkout/')+search,runScripts:'outside-only'});
  const calls=[];let auth;
  const client={auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{auth=fn;}},from(){const q={select(){return q},eq(){return q},in(){return q},order(){return q},limit(){return q},then(resolve){return Promise.resolve({data:orders}).then(resolve)}};return q;}};
  dom.window.supabase={createClient:()=>client};
  dom.window.fetch=async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>url.endsWith('catalog')?{available,sandbox:false}:{status,orderId:'ORDER123'}};};
  dom.window.eval(source);await tick();
  return {dom,d:dom.window.document,calls,signout:async()=>{session=null;auth('SIGNED_OUT',null);await tick();}};
}
(async()=>{
  let p=await page({session:null});assert(!p.d.getElementById('signin-needed').hidden);assert(p.d.getElementById('buy-button').hidden);assert.equal(p.calls.length,0);p.dom.window.close();
  p=await page();assert(p.d.getElementById('buy-button').hidden);assert.match(p.d.getElementById('checkout-status').textContent,/not open yet/);p.dom.window.close();
  p=await page({available:true});assert(!p.d.getElementById('buy-button').hidden);p.d.getElementById('buy-button').click();await tick();assert.equal(p.calls.filter(x=>x.url.endsWith('/create')).length,0,'unchecked consent cannot create order');
  p.d.getElementById('accept-terms').checked=true;p.d.getElementById('buy-button').click();await tick();assert.equal(p.calls.filter(x=>x.url.endsWith('/create')).length,1);assert(!p.d.getElementById('download-collection').hidden);assert(p.d.getElementById('buy-button').hidden);p.dom.window.close();
  p=await page({status:'pending',search:'?token=ORDER123'});assert(p.d.getElementById('download-collection').hidden);assert(!p.d.getElementById('check-payment').hidden);assert.match(p.d.getElementById('checkout-status').textContent,/do not pay again/);p.dom.window.close();
  p=await page({status:'paid',search:'?token=ORDER123'});assert(!p.d.getElementById('download-collection').hidden);assert(p.d.getElementById('buy-button').hidden);await p.signout();assert(p.d.getElementById('download-collection').hidden);p.dom.window.close();
  p=await page({account:true,orders:[{id:'reference',sku:'city-sessions-vol-01',status:'paid',environment:'live',created_at:'2026-10-31T12:00:00Z'}]});assert(!p.d.getElementById('purchases').hidden);assert.match(p.d.getElementById('purchases-list').textContent,/Download complete ZIP/);await p.signout();assert(p.d.getElementById('purchases').hidden);assert.equal(p.d.getElementById('purchases-list').children.length,0);p.dom.window.close();
  p=await page({account:true});assert.match(p.d.getElementById('purchases-status').textContent,/No purchases yet/);p.dom.window.close();
  console.log('PASS: closed checkout, sign-in, consent, successful and pending return, account history, sign-out and empty state.');
})().catch(error=>{console.error(error);process.exitCode=1});
