'use strict';
(() => {
 const cards=Array.from(document.querySelectorAll('.card'));
 const theme=document.getElementById('theme'), access=document.getElementById('access'), search=document.getElementById('search');
 const viewer=document.getElementById('viewer'); let active=0, trigger=null;
 const visible=()=>cards.filter(c=>!c.hidden);
 function filter(){
  const q=search.value.trim().toLowerCase();
  cards.forEach(c=>{c.hidden=!((theme.value==='all'||c.dataset.group===theme.value)&&(access.value==='all'||c.dataset.status===access.value)&&c.dataset.title.includes(q));});
  const n=visible().length;document.getElementById('count').textContent=n+' artwork'+(n===1?'':'s');document.getElementById('empty').hidden=n!==0;
 }
 [theme,access].forEach(el=>el.addEventListener('change',filter));search.addEventListener('input',filter);
 function render(){
  const list=visible(), card=list[active];if(!card)return;
  const src=card.querySelector('img');document.getElementById('viewer-title').textContent=card.querySelector('h2').textContent;
  const im=document.getElementById('viewer-image');im.src=src.getAttribute('src');im.alt=src.alt;
  document.getElementById('position').textContent=(active+1)+' / '+list.length;
  const link=document.getElementById('viewer-link'),target=card.querySelector('.caption a');link.hidden=!target;
  if(target){link.setAttribute('href',target.getAttribute('href'));link.textContent=target.textContent;}else{link.removeAttribute('href');}
  document.getElementById('viewer-status').textContent=card.dataset.status==='free'?'Free original download after member sign-in.':card.dataset.status==='collection'?'Part of City Sessions Vol. 01. Checkout is not open.':'Preview only. This artwork is not available for download yet.';
 }
 cards.forEach(card=>card.querySelector('.art').addEventListener('click',e=>{
  if(typeof viewer.showModal!=='function'){window.open(card.querySelector('img').src,'_blank','noopener');return;}
  trigger=e.currentTarget;active=visible().indexOf(card);render();viewer.showModal();document.body.classList.add('modal-open');
 }));
 function move(step){const n=visible().length;if(n){active=(active+step+n)%n;render();}}
 document.getElementById('previous').addEventListener('click',()=>move(-1));document.getElementById('next').addEventListener('click',()=>move(1));document.getElementById('close').addEventListener('click',()=>viewer.close());
 viewer.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();move(1);}if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}});
 viewer.addEventListener('close',()=>{document.body.classList.remove('modal-open');trigger?.focus();});
 const initialCollection=new URLSearchParams(location.search).get('collection');
 if(Array.from(theme.options).some(o=>o.value===initialCollection))theme.value=initialCollection;
 filter();
})();
