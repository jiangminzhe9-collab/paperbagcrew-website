(()=>{
  'use strict';
  const header=document.querySelector('.header'),menu=document.querySelector('.menu-toggle');
  menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.textContent=open?'Close':'Menu';header.classList.toggle('menu-open',open);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){menu.click();menu.focus();}});
  document.querySelectorAll('.main-nav a').forEach(link=>link.addEventListener('click',()=>{if(menu?.getAttribute('aria-expanded')==='true')menu.click();}));
  const filters=[...document.querySelectorAll('[data-filter]')],products=[...document.querySelectorAll('[data-product]')],count=document.querySelector('#result-count');
  function select(category){
    if(!['all','cards','wallpapers'].includes(category))category='all';
    filters.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===category)));
    products.forEach(product=>product.hidden=category!=='all'&&product.dataset.product!==category);
    if(count){const n=products.filter(p=>!p.hidden).length;count.textContent=n+' collection'+(n===1?'':'s');}
    const url=new URL(location.href);if(category==='all')url.searchParams.delete('category');else url.searchParams.set('category',category);history.replaceState(null,'',url);
  }
  if(filters.length){filters.forEach(button=>button.addEventListener('click',()=>select(button.dataset.filter)));select(new URLSearchParams(location.search).get('category')||'all');}
})();
