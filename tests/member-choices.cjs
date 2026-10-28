const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(root+'/wallpapers/gallery.json')).map(x=>({id:'id'+x.id,gallery_id:x.id,title:x.title,object_path:'test/'+x.id+'.png',preview_url:x.src,collection:x.group}));
let selections=[],inserts=0,signed=0,collision=false,confirm=true,onAuth;
const session={user:{id:'user-a',email:'test@example.invalid'}};
function client(){return {
 auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>onAuth=fn},
 from(table){return {
  select(){const q={eq(){return q},order(){return q},then(resolve){return Promise.resolve({data:table==='wallpapers'?catalog:selections.map(x=>({...x}))}).then(resolve)}};return q},
  async insert(row){inserts++;assert.equal(row.user_id,'user-a');if(collision){collision=false;selections.push({wallpaper_id:'other-device',slot:row.slot});return {error:{code:'23505'}}}assert(row.slot>=1&&row.slot<=6);assert(!selections.some(x=>x.slot===row.slot||x.wallpaper_id===row.wallpaper_id));selections.push(row);return {error:null}}
 }},
 storage:{from(){return {createSignedUrl:async(p)=>{signed++;const item=catalog.find(x=>x.object_path===p);assert(selections.some(x=>x.wallpaper_id===item.id));return {data:{signedUrl:'https://yliacgixfhjhgjemvbpg.supabase.co/storage/v1/object/sign/member-wallpapers/'+p+'?token=test'}}}}}}
};}
const tick=()=>new Promise(r=>setTimeout(r,20));
async function page(){const dom=new JSDOM(fs.readFileSync(root+'/account/index.html','utf8'),{url:'https://paperbagcrew.com/account/',runScripts:'outside-only'});dom.window.supabase={createClient:client};dom.window.confirm=()=>confirm;dom.window.open=()=>({document:{body:{}},location:{replace(){}},close(){}});dom.window.eval(fs.readFileSync(root+'/assets/member.js','utf8'));await tick();return dom;}
(async()=>{
 let dom=await page(),d=dom.window.document;
 assert.equal(d.querySelectorAll('.wallpaper-card').length,53);assert.equal(signed,0,'previews must not sign originals');
 confirm=false;d.querySelector('.wallpaper-actions button').click();await tick();assert.equal(inserts,0,'cancel uses no slot');
 confirm=true;collision=true;d.querySelector('.wallpaper-actions button').click();await tick();assert.equal(selections.length,2);assert.equal(inserts,2);assert.match(d.getElementById('wallpaper-quota').textContent,/4 choices remaining/);
 const n=inserts;d.querySelector('.wallpaper-actions button').click();await tick();assert.equal(inserts,n,'repeat uses no slot');
 while(selections.length<6){const b=[...d.querySelectorAll('.wallpaper-actions button')].find(x=>x.textContent==='Choose this wallpaper');b.click();await tick();}
 assert.equal(d.querySelectorAll('.wallpaper-actions button:disabled').length,48);assert.match(d.getElementById('wallpaper-quota').textContent,/0 choices remaining/);
 dom.window.close();dom=await page();d=dom.window.document;assert.match(d.getElementById('wallpaper-quota').textContent,/6 of 6/,'choices survive a fresh page/device');
 d.getElementById('wallpaper-view').value='chosen';d.getElementById('wallpaper-view').dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelectorAll('.wallpaper-card').length,5);
 onAuth('SIGNED_OUT',null);assert(d.getElementById('wallpapers').hidden);assert.equal(d.querySelectorAll('.wallpaper-card').length,0);dom.window.close();
 const gallery=new JSDOM(fs.readFileSync(root+'/wallpapers/index.html','utf8'),{url:'https://paperbagcrew.com/wallpapers/?collection=Winter%20Collection',runScripts:'outside-only'});gallery.window.eval(fs.readFileSync(root+'/wallpapers/gallery.js','utf8'));assert.equal(gallery.window.document.querySelectorAll('.card:not([hidden])').length,12);assert.equal(gallery.window.document.querySelectorAll('.caption a[href^="/account/?artwork="]').length,53);gallery.window.close();
 console.log('PASS: 53 previews, cancel, concurrent slot retry, repeat download, quota exhaustion, persistence, filters, signout, 53 direct links.');
})().catch(e=>{console.error(e);process.exitCode=1});
