const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const file = process.env.ANALYTICS_FILE || path.join(__dirname, '../analytics.js');
const source = fs.readFileSync(file, 'utf8');
const isFrame = file.includes('site-metrics');
const hostname = isFrame ? 'minzeh.com' : 'dongze.win';
const key = 'dz_analytics_excluded';
function boot(options={}) {
  const storage=options.storage||new Map(), cookies=options.cookies||new Map(), scripts=[], events={},winEvents={},nodes=[];
  const location={hostname,protocol:'https:',origin:'https://'+hostname,pathname:'/',search:'',href:'https://'+hostname+'/',...options.location};
  const window={addEventListener(n,fn){winEvents[n]=fn},removeEventListener(){}};
  const document={readyState:'complete',documentElement:{lang:'zh-Hant'},referrer:'https://search.test/private?email=secret',
    addEventListener(n,fn){events[n]=fn},getElementById(){return nodes[0]},
    createElement(){return {setAttribute(){},addEventListener(){},contentWindow:{postMessage(){}}}},
    head:{appendChild(n){scripts.push(n)}},body:{appendChild(n){nodes.push(n)}}};
  Object.defineProperty(document,'cookie',{get(){if(options.noCookies)throw Error();return [...cookies].map(([k,v])=>k+'='+v).join('; ')},set(s){if(options.noCookies)throw Error();const [k,v]=s.split(';')[0].split('=');if(s.includes('Max-Age=0'))cookies.delete(k);else cookies.set(k,v)}});
  const localStorage={getItem(k){if(options.noStorage)throw Error();return storage.get(k)||null},setItem(k,v){if(options.noStorage)throw Error();storage.set(k,v)},removeItem(k){if(options.noStorage)throw Error();storage.delete(k)}};
  const navigator={...options.navigator};
  const c={window,document,navigator,location,localStorage,URL,URLSearchParams,Date};vm.runInNewContext(source,c);
  return {window,storage,cookies,scripts,nodes,events,winEvents,loaded:()=>scripts.length+nodes.length};
}
test('normal public visits still load the existing measurement once',()=>{const b=boot();assert.equal(b.loaded(),1);assert.equal(b.window['ga-disable-G-7XNY9JBP6C'],false)});
test('explicit exclusion blocks the first hit and persists across navigation',()=>{const b=boot({location:{search:'?analytics=off'}});assert.equal(b.loaded(),0);assert.equal(b.window.siteAnalyticsPreferences.excluded,true);const next=boot({storage:b.storage,cookies:b.cookies,location:{pathname:'/shop/'}});assert.equal(next.loaded(),0)});
test('query-free return visit uses the saved exclusion',()=>{assert.equal(boot({storage:new Map([[key,'1']])}).loaded(),0)});
test('cookie-only exclusion survives localStorage restrictions',()=>{assert.equal(boot({noStorage:true,cookies:new Map([[key,'1']])}).loaded(),0)});
test('storage-only exclusion survives blocked cookies',()=>{assert.equal(boot({noCookies:true,storage:new Map([[key,'1']])}).loaded(),0)});
test('blocked storage still excludes current page and reports inability to save',()=>{const b=boot({noCookies:true,noStorage:true,location:{search:'?analytics=off'}});assert.equal(b.loaded(),0);assert.equal(b.window.siteAnalyticsPreferences.saved,false)});
test('restoring clears both stores and permits a subsequent visit',()=>{const b=boot({location:{search:'?analytics=off'}});b.window.siteAnalyticsPreferences.setExcluded(false);assert.equal(b.storage.has(key),false);assert.equal(b.cookies.has(key),false);assert.equal(boot({storage:b.storage,cookies:b.cookies}).loaded(),1)});
test('analytics=on explicitly clears an old exclusion',()=>{const b=boot({location:{search:'?analytics=on'},storage:new Map([[key,'1']]),cookies:new Map([[key,'1']])});assert.equal(b.loaded(),1)});
test('settings page never sends a hit, even when restoring',()=>{const b=boot({location:{pathname:'/site-stats/',search:'?analytics=on'}});assert.equal(b.loaded(),0);b.window.siteAnalyticsPreferences.setExcluded(false);assert.equal(b.window['ga-disable-G-7XNY9JBP6C'],true)});
test('automated QA, GPC and DNT remain excluded without saving an owner flag',()=>{for(const n of [{webdriver:true},{globalPrivacyControl:true},{doNotTrack:'1'}]){const b=boot({navigator:n});assert.equal(b.loaded(),0);assert.equal(b.storage.size,0)}});
test('preview and unapproved hosts never send measurement',()=>{assert.equal(boot({location:{hostname:'evil.test'}}).loaded(),0)});
test('a second tab notices changed exclusion',()=>{const b=boot();b.storage.set(key,'1');b.winEvents.storage({key});assert.equal(b.window['ga-disable-G-7XNY9JBP6C'],true)});
if(!isFrame) {
 test('events stop immediately after excluding an already open page',()=>{const b=boot();const before=b.window.dataLayer.length;b.window.siteAnalyticsPreferences.setExcluded(true);b.events.click({target:{closest(){return {href:'https://line.me/S/sticker/123/'}}}});assert.equal(b.window.dataLayer.length,before)});
 test('query strings and personal referrer paths never reach GA configuration',()=>{const b=boot({location:{search:'?email=secret#token'}});const config=Array.from(b.window.dataLayer.find(x=>x[0]==='config'))[2];assert.equal(config.page_location,'https://dongze.win/');assert.equal(config.page_referrer,'https://search.test');assert.ok(!JSON.stringify(config).includes('secret'))});
}
