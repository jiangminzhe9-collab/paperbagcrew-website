'use strict';
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const gallery = JSON.parse(read('wallpapers/gallery.json'));
const retired = gallery.filter(item => item.group === 'Paperbag Cats');
const available = gallery.filter(item => item.group !== 'Paperbag Cats');
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

async function checkAccount(legacy) {
  const catalog = gallery.map(item => ({id:'id'+item.id,gallery_id:item.id,title:item.title,
    object_path:'test/'+item.id+'.png',preview_url:item.src,collection:legacy ? item.archive||item.group : item.group}));
  let session = {user:{id:'owner-a',email:'test@example.invalid'}};
  const selections = [
    {user_id:'owner-a',wallpaper_id:'id'+retired[0].id,slot:1},
    {user_id:'owner-a',wallpaper_id:'id'+available[0].id,slot:2}
  ];
  let onAuth, inserts=0, signed=0, opened=0, confirms=0;
  const client = {
    auth:{getSession:async()=>({data:{session}}),onAuthStateChange:callback=>{onAuth=callback;}},
    from(table) {
      return {
        select() {
          let user;
          const query={eq(key,value){if(key==='user_id')user=value;return query;},order(){return query;},
            then(resolve){return Promise.resolve({data:table==='wallpapers'?catalog:selections.filter(row=>row.user_id===user)}).then(resolve);}};
          return query;
        },
        async insert(){inserts++;throw new Error('Saved downloads must not create new choices');}
      };
    },
    storage:{from(bucket){assert.equal(bucket,'member-wallpapers');return {
      async createSignedUrl(objectPath,expires,options){
        const item=catalog.find(row=>row.object_path===objectPath);
        assert(selections.some(row=>row.user_id===session.user.id&&row.wallpaper_id===item.id));
        assert.equal(expires,300);assert(options&&typeof options==='object');signed++;
        return {data:{signedUrl:'https://yliacgixfhjhgjemvbpg.supabase.co/storage/v1/object/sign/member-wallpapers/'+objectPath+'?token=mock'}};
      }
    };}}
  };
  async function open() {
    const dom=new JSDOM(read('account/index.html'),{url:'https://paperbagcrew.com/account/?artwork='+retired[1].id+'#wallpapers',runScripts:'outside-only'});
    dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
    dom.window.supabase={createClient:()=>client};
    dom.window.confirm=()=>{confirms++;return true;};
    dom.window.open=()=>{opened++;return {document:{body:{}},location:{replace(){}},close(){}};};
    // Test the stale-click guard without exposing a production hook.
    const source=read('assets/member.js').replace(/\}\)\(\);\s*$/, 'window.__testOpenWallpaper=openWallpaper;\n})();');
    dom.window.eval(source);await tick();return dom;
  }
  let dom=await open(), doc=dom.window.document;
  assert.equal(doc.querySelectorAll('.wallpaper-card').length,121);
  assert.equal(doc.getElementById('artwork-'+retired[1].id),null,'a retired deep link must not offer a new choice');
  assert(![...doc.querySelectorAll('#wallpaper-collection option')].some(option=>option.textContent==='Paperbag Cats'));
  assert.match(doc.getElementById('wallpaper-quota').textContent,/2 of 6 chosen/);
  assert.match(doc.getElementById('wallpaper-status').textContent,/121 artworks/);
  await dom.window.__testOpenWallpaper(catalog.find(row=>row.gallery_id===retired[1].id),false);
  assert.equal(inserts,0);assert.equal(signed,0);assert.equal(opened,0);assert.equal(confirms,0);
  doc.getElementById('wallpaper-view').value='chosen';
  doc.getElementById('wallpaper-view').dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelectorAll('.wallpaper-card').length,2);
  const owned=doc.getElementById('artwork-'+retired[0].id);assert(owned,'previously selected retired artwork remains available');
  const buttons=owned.querySelectorAll('button');assert.deepEqual([...buttons].map(button=>button.textContent),['Open full-size','Download PNG']);
  buttons[0].click();await tick();
  doc.getElementById('artwork-'+retired[0].id).querySelectorAll('button')[1].click();await tick();
  assert.equal(signed,2);assert.equal(inserts,0);assert.equal(selections.length,2);assert.equal(confirms,0);
  dom.window.close();dom=await open();doc=dom.window.document;
  doc.getElementById('wallpaper-view').value='chosen';doc.getElementById('wallpaper-view').dispatchEvent(new dom.window.Event('change'));
  assert(doc.getElementById('artwork-'+retired[0].id),'entitlement survives reload');
  session={user:{id:'owner-b',email:'other@example.invalid'}};onAuth('SIGNED_IN',session);await tick();
  assert.equal(doc.querySelectorAll('.wallpaper-card').length,0,'another account cannot see the previous account selections');
  assert.match(doc.getElementById('wallpaper-quota').textContent,/0 of 6 chosen/);
  onAuth('SIGNED_OUT',null);assert(doc.getElementById('wallpapers').hidden);assert.equal(doc.querySelectorAll('.wallpaper-card').length,0);
  dom.window.close();
}

(async()=>{
  assert.equal(gallery.length,129);assert.equal(retired.length,8);assert.equal(available.length,121);
  const galleryDom=new JSDOM(read('wallpapers/index.html'));
  assert.equal(galleryDom.window.document.querySelectorAll('article.card').length,121);
  assert(!galleryDom.window.document.body.textContent.includes('Paperbag Cats'));
  assert.equal(galleryDom.window.document.querySelectorAll('[data-group="Paperbag Cats"]').length,0);
  galleryDom.window.close();
  const retiredPage=new JSDOM(read('collections/paperbag-cats/index.html'));
  assert.equal(retiredPage.window.document.querySelectorAll('article.character').length,0);
  assert.equal(JSON.parse(retiredPage.window.document.getElementById('retired-collection-data').textContent).length,8,'character source records preserved');
  assert.match(retiredPage.window.document.querySelector('meta[name="robots"]').content,/noindex/);
  retiredPage.window.close();
  await checkAccount(false);await checkAccount(true);
  console.log('PASS: public retirement, 129 records preserved, 121 browse items, 8 archived character records, stale deep-link guard, old/new classification, saved open/download, reload, account isolation and signout.');
})().catch(error=>{console.error(error);process.exitCode=1;});
