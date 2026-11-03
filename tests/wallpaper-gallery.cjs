'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const gallery = JSON.parse(read('wallpapers/gallery.json'));
const html = read('wallpapers/index.html'), account = read('account/index.html');
const css = read('wallpapers/gallery.css'), js = read('wallpapers/gallery.js');
const expected = {'Office Heroes':10,'Office Workers':10,'Everyday Craftspeople':7,'Paperbag Cats':8,'Taike Series':7,'City After Dark':7,'Street Players':18,'Curious Residents':7,'Baseball Crew':6,'Basketball Starting Five':5,'Winter Collection':12,'City Moments':29,'Street Editions':3};
const attrs = s => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
const decode = s => s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const optionValues = (markup, id) => [...markup.match(new RegExp('<select id="'+id+'">([\\s\\S]*?)<\\/select>'))[1].matchAll(/<option(?: value="([^"]+)")?>([^<]+)<\/option>/g)].map(m=>decode(m[1]||m[2]));
assert.equal(gallery.length,129);assert.equal(new Set(gallery.map(x=>x.id)).size,129);
const counts=gallery.reduce((r,x)=>(r[x.group]=(r[x.group]||0)+1,r),{});assert.deepEqual(counts,expected);
assert.equal(gallery.filter(x=>x.archive==='Street Stories').length,74);
assert.deepEqual(optionValues(html,'theme'),optionValues(account,'wallpaper-collection'));
for (const group of Object.keys(expected)) assert(optionValues(html,'theme').includes(group),group);
assert(optionValues(html,'theme').includes('Street Stories'));
const rawCards=[...html.matchAll(/<article class="card"[^>]*>[\s\S]*?<\/article>/g)].map(m=>m[0]);assert.equal(rawCards.length,129);
for (const card of rawCards){
 const data=attrs(card.split('>')[0]), image=attrs(card.match(/<img [^>]+>/)[0]);const item=gallery.find(x=>x.src===image.src);assert(item);
 assert.equal(data['data-group'],item.group);assert.equal(data['data-orientation'],item.orientation);assert.equal(Number(image.width),item.width);assert.equal(Number(image.height),item.height);
 assert(card.includes(item.orientation==='vertical'?'Vertical wallpaper':'Horizontal artwork'));
 if(item.archive)assert.equal(data['data-archive'],item.archive);
}
assert(!/\.art\{[^}]*aspect-ratio/.test(css));assert(/\.art img\{[^}]*height:auto/.test(css));assert(!/\.art img\{[^}]*(?:height:100%|object-fit:cover)/.test(css));
assert(/\.wallpaper-card img\{[^}]*height:auto/.test(account));assert(!/\.wallpaper-card img\{[^}]*aspect-ratio/.test(account));
assert.equal(gallery.filter(x=>x.orientation==='horizontal').length,6);
function harness(search=''){
 const node=()=>({value:'all',textContent:'',hidden:false,events:{},addEventListener(t,fn){this.events[t]=fn},setAttribute(k,v){this[k]=v},getAttribute(k){return this[k]},removeAttribute(k){delete this[k]},focus(){this.focused=true}});
 const ids=Object.fromEntries(['theme','access','search','viewer','count','empty','previous','next','close','reset-filters','viewer-title','viewer-image','position','viewer-link','viewer-status'].map(id=>[id,node()]));ids.search.value='';ids.theme.options=optionValues(html,'theme').map(value=>({value}));
 const cards=rawCards.map(markup=>{const a=attrs(markup.split('>')[0]),im=attrs(markup.match(/<img [^>]+>/)[0]);const image={...node(),...im},art=node(),title={textContent:decode(markup.match(/<h2>([\s\S]*?)<\/h2>/)[1])},link={...node(),href:markup.match(/<a href="([^"]+)"/)[1],textContent:'Choose this wallpaper ↗'};return{hidden:false,dataset:Object.fromEntries(Object.entries(a).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),decode(v)])),art,querySelector(q){return {'img':image,'.art':art,'h2':title,'.caption a':link}[q]}}});
 const bodyClasses=new Set();let replaced='';ids.viewer.showModal=function(){this.open=true};ids.viewer.close=function(){this.open=false;this.events.close()};
 const context={document:{querySelectorAll:()=>cards,getElementById:id=>ids[id],body:{classList:{add:x=>bodyClasses.add(x),remove:x=>bodyClasses.delete(x)}}},location:{search,href:'https://paperbagcrew.com/wallpapers/'+search},history:{replaceState(a,b,url){replaced=url}},URL,URLSearchParams,window:{open(){throw Error('Unexpected fallback')}}};vm.runInNewContext(js,context);
 return{ids,cards,bodyClasses,visible:()=>cards.filter(c=>!c.hidden),replaced:()=>replaced};
}
let h=harness();assert.equal(h.visible().length,129);
for(const [group,count] of Object.entries(expected)){h.ids.theme.value=group;h.ids.theme.events.change();assert.equal(h.visible().length,count,group)}
h=harness('?collection=Winter%20Collection');assert.equal(h.visible().length,12);h.ids.search.value='Blue Air';h.ids.search.events.input();assert.equal(h.visible().length,1);h.ids['reset-filters'].events.click();assert.equal(h.visible().length,129);assert.equal(h.replaced(),'/wallpapers/');
h=harness('?collection=Street%20Stories');assert.equal(h.visible().length,74);h.ids['reset-filters'].events.click();assert.equal(h.visible().length,129);
h.ids.search.value='no-such-title';h.ids.search.events.input();assert.equal(h.visible().length,0);assert.equal(h.ids.empty.hidden,false);h.ids['reset-filters'].events.click();
for(let i=0;i<2;i++){const first=h.visible()[0];first.art.events.click({currentTarget:first.art});assert.equal(h.ids.viewer.open,true);assert(h.bodyClasses.has('modal-open'));h.ids.next.events.click();assert.equal(h.ids.position.textContent,'2 / 129');h.ids.close.events.click();assert.equal(h.ids.viewer.open,false);assert(!h.bodyClasses.has('modal-open'));assert(first.art.focused)}
// Account classification works with pre-migration and post-migration catalog rows.
const member=read('assets/member.js');const helper=member.slice(member.indexOf('  const storyRanges ='),member.indexOf('  const renderWallpapers ='));
const c={};vm.runInNewContext(helper+'\nthis.collectionOf=wallpaperCollection;this.isStory=isCharacterStory;',c);
for (const item of gallery){const row={collection:item.archive||item.group,preview_url:item.src};assert.equal(c.collectionOf(row),item.group);assert.equal(c.isStory(row),item.archive==='Street Stories');assert.equal(c.collectionOf({...row,collection:item.group}),item.group)}
const filter=member.match(/const items = catalog\.filter\(item => ([^\n]+)\);/)[1];
const catalog=gallery.map(x=>({id:String(x.id),title:x.title,preview_url:x.src,collection:x.archive||x.group}));const state={...c,catalog,group:'all',view:'all',term:'',selected:()=>false,wallpaperCollection:c.collectionOf,isCharacterStory:c.isStory};
const run=()=>vm.runInNewContext('catalog.filter(item => '+filter+').length',state);assert.equal(run(),129);state.group='Street Stories';assert.equal(run(),74);state.group='Paperbag Cats';assert.equal(run(),8);state.group='Winter Collection';assert.equal(run(),12);state.term='blue air';assert.equal(run(),1);state.group='all';state.term='';assert.equal(run(),129);
console.log('PASS: 129 artworks, 13 collections, 74-item legacy alias, reset/search/dialog repetition, account classification before/after migration, natural image ratios.');
