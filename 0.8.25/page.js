/* Paragraph grouping and viewport-first traversal adapted from TWP,
 * FilipePS/Traduzir-paginas-web, src/contentScript/pageTranslator.js.
 * This file is available under MPL-2.0; see licenses/TWP-MPL-2.0.txt.
 * Bayan preserves existing text nodes, links and listeners; never inserts
 * untrusted translated HTML into the page. */
'use strict';
globalThis.BayanPage=(()=>{
 const records=new Map(),cache=new Map();let generation=0,observer,timer,scrollTimer,queue=[],running=false,options={},total=0,done=0,failed=0,active=0,engines=new Set(),note='';
 const skip='script,style,noscript,textarea,input,select,option,code,pre,kbd,samp,svg,math,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,.CodeMirror,.material-icons,.material-symbols-outlined,[hidden],[aria-hidden="true"],#bayan-extension-root';
 const status=()=>({running,total,done,failed,remaining:queue.reduce((n,u)=>n+u.records.length,0)+active,translated:records.size,engines:[...engines],note});
 const emit=()=>globalThis.bayanPageStateChanged?.(status());
 function eligible(n){const p=n.parentElement;return !!p&&n.isConnected&&/\p{L}/u.test(n.nodeValue||'')&&!p.closest(skip)&&p.getClientRects().length>0&&getComputedStyle(p).visibility!=='hidden';}
 function block(n){let p=n.parentElement;while(p&&p!==document.body&&['inline','contents','inline-block'].includes(getComputedStyle(p).display))p=p.parentElement;return p||document.body;}
 function visible(unit){return unit.records.some(r=>{const b=r.node.parentElement?.getBoundingClientRect();return b&&b.bottom>=0&&b.top<=innerHeight;});}
 function collect(root=document.body){
  if(!root)return;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let unit=null;
  for(let n=walker.nextNode();n;n=walker.nextNode()){
   if(!eligible(n)){unit=null;continue;}const old=records.get(n);if(old&&(n.nodeValue===old.written||old.pending)){unit=null;continue;}
   const r={node:n,original:n.nodeValue,written:n.nodeValue,pending:true},parent=block(n);records.set(n,r);total++;
   if(!unit||unit.parent!==parent||unit.length+n.nodeValue.length>1000||unit.records.length>=30){unit={parent,records:[],length:0};queue.push(unit);}
   unit.records.push(r);unit.length+=n.nodeValue.length;
  }
 }
 async function requestSingle(text,token){const chunks=[];let rest=text;while(rest.length>8000){let cut=rest.lastIndexOf(' ',8000);if(cut<2000)cut=8000;else cut++;if(/[\uD800-\uDBFF]/.test(rest[cut-1]))cut--;chunks.push(rest.slice(0,cut));rest=rest.slice(cut);}if(rest)chunks.push(rest);const output=[];let result;
  for(const part of chunks){if(token!==generation)return null;result=await chrome.runtime.sendMessage({type:'page-translate-text',text:part,engine:options.engine,target:options.target,source:options.source||'auto'});if(!result?.ok)return result;output.push(result.text);}return {...result,items:[output.join(' ')]};
 }
 async function translateUnit(unit,token){
  const group=unit.records.filter(r=>eligible(r.node));const skipped=unit.records.length-group.length;done+=skipped;for(const r of unit.records)if(!group.includes(r))r.pending=false;if(!group.length)return;
  const pieces=group.map(r=>r.original),key=JSON.stringify([options.engine,options.target,pieces]);let result=cache.get(key);
  if(!result){result=group.length===1?await requestSingle(pieces[0],token):await chrome.runtime.sendMessage({type:'page-translate-pieces',pieces,engine:options.engine,target:options.target,source:options.source||'auto'});if(result?.ok){if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(key,result);}}
  if(token!==generation)return;
  for(let i=0;i<group.length;i++){const r=group[i];r.pending=false;if(!result?.ok||typeof result.items?.[i]!=='string'){failed++;records.delete(r.node);note=result?.error||'تعذر ترجمة بعض النصوص.';}
   else if(r.node.isConnected&&r.node.nodeValue===r.original){const prefix=r.original.match(/^\s*/)?.[0]||'',suffix=r.original.match(/\s*$/)?.[0]||'';r.written=prefix+result.items[i].trim()+suffix;r.node.nodeValue=r.written;engines.add(result.engine||options.engine);}
   else if(r.node.isConnected){records.delete(r.node);scheduleCollect();}done++;
  }
 }
 function waiting(){return queue.length&&options.lazy?'تتم ترجمة بقية الصفحة أثناء التمرير.':failed?'اكتملت الترجمة مع تعذر بعض النصوص.':'اكتملت ترجمة نصوص الصفحة.';}
 function pump(token){
  if(token!==generation)return;
  while(active<2&&queue.length){let index=queue.findIndex(visible);if(index<0){if(options.lazy)break;index=0;}const unit=queue.splice(index,1)[0];active++;running=true;
   translateUnit(unit,token).catch(e=>{if(token===generation){failed+=unit.records.length;done+=unit.records.length;for(const r of unit.records){r.pending=false;records.delete(r.node);}note=e.message;}}).finally(()=>{if(token!==generation)return;active--;if(active===0){running=false;note=waiting();}emit();setTimeout(()=>pump(token),100);});
  }
  if(active===0){running=false;note=waiting();emit();}
 }
 function scheduleCollect(){if(!options.dynamic)return;clearTimeout(timer);timer=setTimeout(()=>{collect();pump(generation);emit();},500);}
 function watch(){observer?.disconnect();observer=new MutationObserver(changes=>{if(changes.some(c=>c.type==='childList'?c.addedNodes.length:c.target.nodeValue!==records.get(c.target)?.written))scheduleCollect();});observer.observe(document.body,{subtree:true,childList:true,characterData:true});}
 addEventListener('scroll',()=>{if(!queue.length)return;clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>pump(generation),120);},{passive:true,capture:true});
 function stop(){generation++;observer?.disconnect();clearTimeout(timer);clearTimeout(scrollTimer);queue=[];active=0;running=false;for(const r of records.values())r.pending=false;note='توقفت ترجمة الصفحة.';emit();return status();}
 function restore(){stop();for(const r of records.values())if(r.node.isConnected&&r.node.nodeValue===r.written)r.node.nodeValue=r.original;records.clear();cache.clear();total=done=failed=0;engines.clear();note='تمت استعادة النص الأصلي.';emit();return status();}
 function start(settings={}){restore();generation++;options={engine:'google',target:'ar',source:'auto',dynamic:true,lazy:true,...settings};note='جارٍ ترجمة الفقرات الظاهرة…';collect();running=queue.length>0;if(options.dynamic&&document.body)watch();pump(generation);emit();return status();}
 return {status,start,stop,restore};
})();
