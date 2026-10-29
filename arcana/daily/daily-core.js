(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DailyArcana=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function selection(seed,date){return {date,id:hash(seed+':'+date+':card')%78,reversed:!!(hash(seed+':'+date+':orientation')%2)};}
function validRecord(r,date){return !!r&&r.date===date&&Number.isInteger(r.id)&&r.id>=0&&r.id<78&&typeof r.reversed==='boolean';}
return {dateKey,selection,validRecord};
});
