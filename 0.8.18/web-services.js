/* This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. See licenses/TWP-MPL-2.0.txt.
 * Service adapters adapted from FilipePS/Traduzir-paginas-web (TWP):
 * src/background/translationService.js and textToSpeech.js.
 * Modified for Bayan: Fetch/MV3, plain-text requests, bounded memory cache,
 * persistent page cache, parallel viewport batches, explicit fallback,
 * cancellable audio chunks. No private API keys included.
 */
'use strict';
const webCache=new Map();const pageMemory=new Map();const pageInflight=new Map();let pageDbPromise=null,pagePuts=0,bingAuth=null,yandexAuth=null,bingSpeechAuth=null;
function openPageDb(){
 if(!pageDbPromise)pageDbPromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open('bayan-page-cache',1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('entries')){const store=db.createObjectStore('entries',{keyPath:'key'});store.createIndex('at','at');}};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>{pageDbPromise=null;reject(request.error);};
 });
 return pageDbPromise;
}
async function pageCacheKey(parts){
 const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(JSON.stringify(parts)));
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function pageCacheGet(key){
 if(pageMemory.has(key))return pageMemory.get(key);
 try{
  const db=await openPageDb();
  const record=await new Promise((resolve,reject)=>{const request=db.transaction('entries','readonly').objectStore('entries').get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});
  if(record){if(pageMemory.size>=400)pageMemory.delete(pageMemory.keys().next().value);pageMemory.set(key,record);}
  return record;
 }catch{return null;}
}
async function pageCachePut(key,record){
 const stored={key,...record,at:Date.now()};
 if(pageMemory.size>=400)pageMemory.delete(pageMemory.keys().next().value);
 pageMemory.set(key,stored);
 try{
  const db=await openPageDb();
  await new Promise((resolve,reject)=>{const tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(stored);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  if(++pagePuts%40===0)trimPageCache(db);
 }catch{}
}
function trimPageCache(db){
 const store=db.transaction('entries','readwrite').objectStore('entries'),countRequest=store.count();
 countRequest.onsuccess=()=>{const extra=countRequest.result-4500;if(extra<=0)return;let removed=0;const cursor=store.index('at').openCursor();cursor.onsuccess=()=>{const current=cursor.result;if(!current||removed>=extra)return;removed++;current.delete();current.continue();};};
}
function escapeHtml(text){return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function decodeHtml(text){return String(text).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(full,c)=>{if(c[0]==='#'){const n=c[1].toLowerCase()==='x'?parseInt(c.slice(2),16):parseInt(c.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):full;}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[c.toLowerCase()]||full;});}
function markPieces(pieces){return pieces.map((piece,index)=>`<a i=${index}>${escapeHtml(piece)}</a>`).join('');}
function parseMarkedPieces(text,count,dontSort,pattern){
 const values=new Array(count),ordered=[],seen=new Set();let end=0,last=-1;
 for(const match of String(text).matchAll(pattern)){
  const id=Number(match[1]);if(id>=count||seen.has(id))return null;
  const decoded=decodeHtml(String(text).slice(end,match.index)+(match[2]||'')).trim();
  seen.add(id);values[id]=decoded;ordered.push(decoded);end=match.index+match[0].length;last=id;
 }
 if(seen.size!==count)return null;
 if(last>=0){const tail=decodeHtml(String(text).slice(end));values[last]+=tail;ordered[ordered.length-1]+=tail;}
 return dontSort?ordered:values;
}
async function mapPool(items,limit,fn){
 let cursor=0;
 async function worker(){while(cursor<items.length){const index=cursor++;await fn(items[index],index);}}
 await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
}
function splitWebText(text,limit){
 const parts=[];let remaining=String(text);
 while(remaining.length>limit){let cut=remaining.lastIndexOf(' ',limit);const newline=remaining.lastIndexOf('\n',limit);cut=Math.max(cut,newline);if(cut<limit/3)cut=limit;else cut++;if(/[\uD800-\uDBFF]/.test(remaining[cut-1]))cut--;parts.push(remaining.slice(0,cut));remaining=remaining.slice(cut);}
 if(remaining)parts.push(remaining);return parts;
}
let webFetchBackoffUntil=0;
async function webFetchRaw(url,options={}){
 const {bayanPriority,...fetchOptions}=options;
 let response;try{response=await fetch(url,{...fetchOptions,signal:fetchOptions.signal||AbortSignal.timeout(18000),credentials:fetchOptions.credentials||'omit'});}catch(e){if(e.name==='AbortError')throw e;throw Error('تعذر الاتصال بخدمة الترجمة.');}
 if(!response.ok)throw Error(response.status===429?'الخدمة حدّت الطلبات مؤقتًا.':`خدمة الويب غير متاحة (${response.status}).`);return response;
}
// Background tabs share a small pool; foreground page translate stays unthrottled (fast like 0.8.9).
const webFetchPool={limit:2,active:0,waiters:[]};
function webFetchPriorityValue(options={}){return options.bayanPriority==='low'?1:0;}
function webFetchPump(){
 webFetchPool.waiters.sort((a,b)=>a.priority-b.priority||a.seq-b.seq);
 while(webFetchPool.active<webFetchPool.limit&&webFetchPool.waiters.length){
  const next=webFetchPool.waiters.shift();
  webFetchPool.active++;
  next.resolve();
 }
}
let webFetchWaitSeq=0;
function webFetchAcquire(priority){
 if(webFetchPool.active<webFetchPool.limit&&!webFetchPool.waiters.some(w=>w.priority<priority)){
  webFetchPool.active++;
  return Promise.resolve();
 }
 return new Promise(resolve=>{webFetchPool.waiters.push({priority,seq:++webFetchWaitSeq,resolve});webFetchPump();});
}
function webFetchRelease(){webFetchPool.active=Math.max(0,webFetchPool.active-1);webFetchPump();}
async function webFetchWithRetry(url,options={}){
 for(let attempt=0;attempt<5;attempt++){
  const wait=Math.max(0,webFetchBackoffUntil-Date.now());
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  try{return await webFetchRaw(url,options);}
  catch(e){
   const limited=/حدّت|429/.test(e.message||'');
   if(!limited||attempt===4)throw e;
   const delay=Math.min(30000,800*Math.pow(2,attempt));
   webFetchBackoffUntil=Date.now()+delay;
  }
 }
}
async function webFetch(url,options={}){
 const priority=webFetchPriorityValue(options);
 // Foreground: no concurrency cap — same speed as pre-queue builds.
 if(priority===0)return webFetchWithRetry(url,options);
 await webFetchAcquire(priority);
 try{return await webFetchWithRetry(url,options);}
 finally{webFetchRelease();}
}
async function bingToken(){if(bingAuth&&Date.now()-bingAuth.time<7*60000)return bingAuth.token;const token=(await(await webFetch('https://edge.microsoft.com/translate/auth')).text()).trim();if(!token||token.startsWith('<'))throw Error('تعذر تهيئة Bing.');bingAuth={token,time:Date.now()};return token;}
async function yandexSession(){
 if(yandexAuth&&Date.now()-yandexAuth.time<15*60000)return yandexAuth.sid;
 const html=await(await webFetch('https://translated.turbopages.org/proxy_u/en-es.en/https/example.com/')).text();
 const sid=html.match(/sid\s*:\s*['"]([0-9a-f.]+)['"]/i)?.[1];if(!sid)throw Error('تعذر تهيئة Yandex.');yandexAuth={sid,time:Date.now()};return sid;
}
function bayanFetchOpts(input,extra={}){return input?.bayanPriority?{...extra,bayanPriority:input.bayanPriority}:extra;}
async function webTranslatePart(engine,text,source,target,input){
 if(engine==='google'){
  const url=new URL('https://translate.googleapis.com/translate_a/single');for(const [k,v]of Object.entries({client:'gtx',sl:source||'auto',tl:target,dt:'t',q:text}))url.searchParams.set(k,v);
  const data=await(await webFetch(url.href,bayanFetchOpts(input))).json();const translated=data?.[0]?.map(row=>row?.[0]||'').join('');if(!translated)throw Error('لم يُرجع Google ترجمة.');return {text:translated,source:data[2]||source};
 }
 if(engine==='bing'){
  const auth=await webSpeechAuth(AbortSignal.timeout(18000)),url=new URL('https://www.bing.com/ttranslatev3');for(const [k,v]of Object.entries({isVertical:'1',IG:auth.ig,IID:auth.iid+'.1'}))url.searchParams.set(k,v);
  const data=await(await webFetch(url.href,bayanFetchOpts(input,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({fromLang:source||'auto-detect',to:target,text,key:String(auth.key),token:auth.token}).toString()}))).json();
  if(!data?.[0]?.translations?.[0]?.text)throw Error('لم يُرجع Bing ترجمة.');return {text:data[0].translations[0].text,source:data[0].detectedLanguage?.language||source};
 }
 if(engine==='yandex'){
  const sid=await yandexSession(),url=new URL('https://translate.yandex.net/api/v1/tr.json/translate');
  for(const [k,v]of Object.entries({srv:sid.length>40?'tr-touch-url':'tr-url-widget',id:sid+'-0-0',format:'plain',lang:source?`${source}-${target}`:target,text}))url.searchParams.set(k,v);
  const data=await(await webFetch(url.href,bayanFetchOpts(input))).json();if(data.code!==200||!data.text?.length)throw Error('لم يُرجع Yandex ترجمة.');return {text:data.text.join(''),source:data.lang?.split('-')[0]||source};
 }
 if(engine==='deepl'){
  const data=await(await webFetch('https://oneshot-free.www.deepl.com/v1/storefront/translate',bayanFetchOpts(input,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language_model:'next-gen',source_lang:source||'auto',target_lang:target==='en'?'en-US':target,usage_type:'Translate',text:[text]})}))).json();
  if(!data.translations?.[0]?.text)throw Error('لم يُرجع DeepL ترجمة لهذه اللغة.');return {text:data.translations[0].text,source:data.translations[0].detected_source_language?.toLowerCase()||source};
 }
 throw Error('محرك غير معروف.');
}
async function translateWeb(input){
 const text=String(input.text||'').trim();if(!text)throw Error('حدد نصًا أو اكتبه أولًا.');if(text.length>12000)throw Error('الحد في هذه النسخة 12000 حرف للطلب.');
 const {prefs={}}=await chrome.storage.local.get('prefs'),enabled=['google','bing','yandex','deepl'].filter(e=>prefs['service_'+e]!==false);
 const requested=input.engine==='microsoft'?'bing':input.engine==='memory'?'google':input.engine;
 const primary=enabled.includes(requested)?requested:enabled[0];if(!primary)throw Error('فعّل محرك ترجمة واحدًا على الأقل من الإعدادات.');
 const candidates=prefs.webFallback===false?[primary]:[primary,...enabled.filter(e=>e!==primary)];
 const source=/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(input.source||'')?input.source:'',target=input.target==='en'?'en':'ar';
 let lastError;
 for(const engine of candidates){
  const key=JSON.stringify([engine,source,target,text]);if(prefs.webCache!==false&&webCache.has(key))return {...webCache.get(key),cached:true,fallback:engine!==primary};
  if(prefs.webCache!==false){const stored=await pageCacheGet(await pageCacheKey(['text',engine,source,target,text]));if(stored?.text){const result={text:stored.text,source:stored.detected||source,engine:stored.engine||engine,fallback:engine!==primary,cached:true};if(webCache.size>=100)webCache.delete(webCache.keys().next().value);webCache.set(key,result);return result;}}
  try{
   const chunks=splitWebText(text,engine==='google'||engine==='yandex'?1800:4500),translated=[];let detected=source;
   for(const part of chunks){const result=await webTranslatePart(engine,part,source,target,input);translated.push(result.text);if(result.source)detected=result.source;}
   const result={text:translated.join(' '),source:detected,engine,fallback:engine!==primary};if(prefs.webCache!==false){if(webCache.size>=100)webCache.delete(webCache.keys().next().value);webCache.set(key,result);await pageCachePut(await pageCacheKey(['text',engine,source,target,text]),{text:result.text,detected:result.source,engine:result.engine});}return result;
  }catch(e){lastError=e;}
 }
 throw Error(`${primary}: ${lastError?.message||'تعذرت الترجمة.'} جرّب محركًا آخر.`);
}
async function translatePagePieces(input){
 const pieces=Array.isArray(input.pieces)?input.pieces.map(String):[];if(!pieces.length||pieces.length>80)throw Error('مجموعة نصوص غير صالحة.');
 const {prefs={}}=await chrome.storage.local.get('prefs');
 const requested=input.engine==='microsoft'?'bing':input.engine==='memory'?'google':input.engine;
 const enabled=['google','bing','yandex','deepl'].filter(e=>prefs['service_'+e]!==false);
 const primary=enabled.includes(requested)?requested:enabled[0]||'';
 const source=/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(input.source||'')?input.source:'',target=input.target==='en'?'en':'ar';
 const cacheKey=prefs.webCache===false||!primary?'':await pageCacheKey(['pieces',primary,source,target,pieces,!!input.dontSortResults]);
 if(cacheKey){const hit=await pageCacheGet(cacheKey);if(hit?.items?.length===pieces.length)return {items:hit.items,engine:hit.engine||primary,source:hit.detected||source,cached:true,fallback:!!hit.fallback};}
 const marked=pieces.map((s,i)=>`<b${i}>${escapeHtml(s)}</b${i}>`).join('');
 if(pieces.length>1&&marked.length<=1700){
  try{const r=await translateWeb({...input,text:marked});const items=parseMarkedPieces(r.text,pieces.length,!!input.dontSortResults,/<b(\d+)>([\s\S]*?)<\/b\1>/gi);if(!items)throw Error('تغيرت علامات الفقرة.');const result={...r,items};if(cacheKey)await pageCachePut(cacheKey,{items,engine:r.engine,detected:r.source,fallback:!!r.fallback});return result;}catch{}
 }
 const items=[];let engine,detected=source,fallback=false;for(const text of pieces){const r=await translateWeb({...input,text});items.push(r.text);engine=r.engine;detected=r.source||detected;fallback=fallback||!!r.fallback;}
 if(cacheKey)await pageCachePut(cacheKey,{items,engine,detected,fallback});
 return {items,engine,source:detected,fallback};
}
async function googleTranslateHtmlQueries(queries,source,target,input){
 const params=new URLSearchParams();params.set('client','gtx');params.set('sl',source||'auto');params.set('tl',target);params.set('format','html');
 for(const query of queries)params.append('q',query);
 const data=await(await webFetch('https://translate.googleapis.com/translate_a/t?'+params.toString(),bayanFetchOpts(input))).json();
 const list=Array.isArray(data)?data:typeof data==='string'?[data]:null;
 if(!list||list.length!==queries.length||list.some(item=>typeof item!=='string'||!item.trim()))throw Error('لم يُرجع Google ترجمة.');
 return list;
}
async function translateJobWithPieces(job,input){
 if(job.items)return;
 const pending=pageInflight.get(job.key);
 if(pending){job.items=(await pending).items;job.engine=(await pending).engine;job.detected=(await pending).detected;job.fallback=(await pending).fallback;return;}
 const run=(async()=>{const result=await translatePagePieces({...input,pieces:job.pieces});if(result?.items?.length!==job.pieces.length)throw Error('تعذرت ترجمة فقرة.');return result;})();
 if(job.key)pageInflight.set(job.key,run);
 try{const result=await run;job.items=result.items;job.engine=result.engine;job.detected=result.source;job.fallback=result.fallback;}
 finally{if(job.key)pageInflight.delete(job.key);}
}
async function translateGooglePack(pack,ctx,input){
 let translated=null,lastError;
 for(let attempt=0;attempt<2&&!translated;attempt++){
  try{translated=await googleTranslateHtmlQueries(pack.map(job=>job.query),ctx.source,ctx.target,input);}
  catch(e){lastError=e;if(attempt===0&&/حدّت/.test(e.message||''))await new Promise(resolve=>setTimeout(resolve,600));}
 }
 if(!translated){for(const job of pack){try{await translateJobWithPieces(job,input);}catch{job.error=lastError?.message;}}}
 else await Promise.all(pack.map(async(job,index)=>{
  const items=parseMarkedPieces(translated[index],job.pieces.length,!!input.dontSortResults,/<a\s+i=(\d+)\s*>([\s\S]*?)<\/a>/gi);
  if(items){job.items=items;job.engine='google';job.detected=ctx.source;return;}
  try{await translateJobWithPieces(job,input);}catch(e){job.error=e.message;}
 }));
}
async function translatePageHtml(input){
 const groups=Array.isArray(input.sourceArray2d)?input.sourceArray2d:[];
 if(!groups.length||groups.length>400)throw Error('مجموعة نصوص غير صالحة.');
 const {prefs={}}=await chrome.storage.local.get('prefs');
 const requested=input.engine==='microsoft'?'bing':input.engine==='memory'?'google':input.engine;
 const enabled=['google','bing','yandex','deepl'].filter(e=>prefs['service_'+e]!==false);
 const primary=enabled.includes(requested)?requested:enabled[0];
 if(!primary)throw Error('فعّل محرك ترجمة واحدًا على الأقل من الإعدادات.');
 const source=/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(input.source||'')?input.source:'',target=input.target==='en'?'en':'ar';
 const output=new Array(groups.length),jobs=[],byKey=new Map(),engines=new Set();let failed=0;
 for(let index=0;index<groups.length;index++){
  const pieces=Array.isArray(groups[index])?groups[index].map(String):null;
  if(!pieces?.length||pieces.length>80){output[index]=pieces||[];failed++;continue;}
  const key=prefs.webCache===false?'':await pageCacheKey(['pieces',primary,source,target,pieces,!!input.dontSortResults]);
  if(key){const hit=await pageCacheGet(key);if(hit?.items?.length===pieces.length){output[index]=hit.items;if(hit.engine)engines.add(hit.engine);continue;}if(byKey.has(key)){byKey.get(key).indexes.push(index);continue;}}
  const job={key,pieces,indexes:[index],query:markPieces(pieces)};
  if(key)byKey.set(key,job);
  jobs.push(job);
 }
 if(primary==='google'){
  const packs=[],direct=[];let batch=[],size=0;
  for(const job of jobs){
   if(job.query.length>1800){direct.push(job);continue;}
   if(batch.length&&size+job.query.length>800){packs.push(batch);batch=[];size=0;}
   batch.push(job);size+=job.query.length;
  }
  if(batch.length)packs.push(batch);
  await Promise.all([...packs.map(pack=>translateGooglePack(pack,{source,target},input)),...direct.map(job=>translateJobWithPieces(job,input).catch(e=>{job.error=e.message;}))]);
 }else await mapPool(jobs,input?.bayanPriority==='low'?4:12,job=>translateJobWithPieces(job,input).catch(e=>{job.error=e.message;}));
 const enginesSeen=engines;let missed=0;
 for(const job of jobs){
  const items=job.items?.length===job.pieces.length?job.items:null;
  for(const index of job.indexes){if(items)output[index]=items;else{output[index]=job.pieces;missed++;}}
  if(items&&job.key)await pageCachePut(job.key,{items,engine:job.engine||primary,detected:job.detected||source,fallback:!!job.fallback});
  if(job.engine)enginesSeen.add(job.engine);
 }
 for(let index=0;index<output.length;index++)if(!output[index])output[index]=[];
 return {groups:output,engines:[...enginesSeen],failed:failed+missed,engine:enginesSeen.values().next().value||primary};
}
async function webSpeechAuth(signal){
 if(bingSpeechAuth&&Date.now()-bingSpeechAuth.time<20*60000)return bingSpeechAuth;
 const html=await(await webFetch('https://www.bing.com/translator',{signal,credentials:'include'})).text();
 const ig=html.match(/IG:\s*"([^"]+)"/)?.[1],iid=html.match(/data-iid="([^"]+)"/)?.[1];
 const raw=html.match(/params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/s)?.[1];let values;try{values=JSON.parse(raw);}catch{}
 if(!ig||!iid||!values?.[1])throw Error('تعذر تهيئة صوت Bing. اختر صوت Google من الإعدادات.');
 bingSpeechAuth={ig,iid,key:values[0],token:values[1],time:Date.now()};return bingSpeechAuth;
}
async function webSpeechChunk(message,signal){
 const text=String(message.text||'').trim(),lang=String(message.lang||'ar').toLowerCase().split('-')[0];let response;
 if(message.mode==='bing'){
  const voices={ar:['ar-SA','ar-SA-HamedNeural'],en:['en-US','en-US-AriaNeural'],fr:['fr-FR','fr-FR-DeniseNeural'],de:['de-DE','de-DE-KatjaNeural'],es:['es-ES','es-ES-ElviraNeural'],ru:['ru-RU','ru-RU-SvetlanaNeural'],tr:['tr-TR','tr-TR-EmelNeural'],ja:['ja-JP','ja-JP-NanamiNeural'],zh:['zh-CN','zh-CN-XiaoxiaoNeural']};
  const voice=voices[lang];if(!voice)throw Error('صوت Bing لهذه اللغة غير مضاف؛ اختر Google للصوت.');
  const auth=await webSpeechAuth(signal),url=new URL('https://www.bing.com/tfettts');for(const [k,v]of Object.entries({isVertical:'1',IG:auth.ig,IID:auth.iid+'.1'}))url.searchParams.set(k,v);
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const body=new URLSearchParams({ssml:`<speak version="1.0" xml:lang="${voice[0]}"><voice name="${voice[1]}" xml:lang="${voice[0]}"><prosody rate="0%">${escape(text)}</prosody></voice></speak>`,key:String(auth.key),token:auth.token});
  response=await webFetch(url.href,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),signal});
 }else{
  const url=new URL('https://translate.google.com/translate_tts');for(const [k,v]of Object.entries({ie:'UTF-8',tl:lang,client:'dict-chrome-ex',ttsspeed:'0.5',q:text}))url.searchParams.set(k,v);
  response=await webFetch(url.href,{signal});
 }
 if(!response.headers.get('content-type')?.startsWith('audio/'))throw Error('لم تصل بيانات صوتية من الخدمة. جرّب محرك الصوت الآخر.');
 const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length)throw Error('الملف الصوتي فارغ.');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {ok:true,audio:btoa(binary),mime:response.headers.get('content-type')||'audio/mpeg'};
}
