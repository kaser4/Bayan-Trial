/* Bayan bridge for the upstream TWP page translator. MPL-2.0. */
'use strict';
const checkedLastError=()=>{try{void chrome.runtime.lastError;}catch{}};
function bayanRuntimeSend(message){
 try{
  if(!chrome.runtime?.id)return Promise.resolve(undefined);
  return chrome.runtime.sendMessage(message).catch(()=>undefined);
 }catch{return Promise.resolve(undefined);}
}
const platformInfo={isMobile:{any:false}};
const bayanLangBase=code=>{const s=String(code||'').trim().toLowerCase().replace(/_/g,'-');if(!s||s==='und')return '';return s.split('-')[0];};
const bayanLangList=v=>Array.isArray(v)?v:String(v||'').split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
// Script-detectable languages for selective translation on mixed pages (en+ar+zh, etc.).
const bayanScriptRes={zh:/[\u4e00-\u9fff]/,ja:/[\u3040-\u30ff]/,ko:/[\uac00-\ud7af]/,ar:/[\u0600-\u06ff]/,fa:/[\u0600-\u06ff]/,ur:/[\u0600-\u06ff]/,ru:/[\u0400-\u04ff]/,uk:/[\u0400-\u04ff]/,he:/[\u0590-\u05ff]/,hi:/[\u0900-\u097f]/,th:/[\u0e00-\u0e7f]/,bn:/[\u0980-\u09ff]/};
const bayanScriptChunkRes={zh:/[\u4e00-\u9fff]+/g,ja:/[\u3040-\u30ff]+/g,ko:/[\uac00-\ud7af]+/g,ar:/[\u0600-\u06ff]+/g,fa:/[\u0600-\u06ff]+/g,ur:/[\u0600-\u06ff]+/g,ru:/[\u0400-\u04ff]+/g,uk:/[\u0400-\u04ff]+/g,he:/[\u0590-\u05ff]+/g,hi:/[\u0900-\u097f]+/g,th:/[\u0e00-\u0e7f]+/g,bn:/[\u0980-\u09ff]+/g};
const bayanHasScriptLang=code=>!!bayanScriptRes[bayanLangBase(code)];
const bayanTextMatchesLangs=(text,langs)=>{
 const s=String(text||'');
 return (langs||[]).some(l=>{
  const b=bayanLangBase(l);
  if(b==='ja')return /[\u3040-\u30ff]/.test(s);
  const re=bayanScriptRes[b];
  return!!(re&&re.test(s));
 });
};
const bayanSelectiveFromSample=(always,target,sample)=>{
 const t=bayanLangBase(target);
 return [...new Set(bayanLangList(always).map(bayanLangBase).filter(Boolean))]
  .filter(b=>b&&b!==t&&bayanHasScriptLang(b)&&bayanTextMatchesLangs(sample,[b]));
};
const bayanSelectiveChunkRegex=(langs)=>{
 const parts=[];
 for(const l of langs||[]){
  const b=bayanLangBase(l);
  if(b==='ja')parts.push('[\\u3040-\\u30ff]+');
  else if(bayanScriptChunkRes[b])parts.push(bayanScriptChunkRes[b].source);
 }
 if(!parts.length)return null;
 return new RegExp('('+parts.join('|')+')','g');
};
const twpLang={fixTLanguageCode:code=>{const raw=String(code||'').toLowerCase().replace(/_/g,'-');return({'zh-cn':'zh-CN','zh-tw':'zh-TW','zh-hans':'zh-CN','zh-hant':'zh-TW',iw:'he',nb:'no'}[raw]||raw);}};
globalThis.bayanSelectiveLangs=null;
let twpSettings={},twpConfigValues={},twpReadyResolve,twpBridgeGeneration=0,twpStats={active:0,done:0,failed:0,engines:[]},twpOriginalNodes=[];
let bayanSelectiveGen=0,bayanSelectiveNodes=new Map(),bayanSelectiveObserver=null,bayanSelectiveTimer=0;
const twpEngineReady=new Promise(resolve=>twpReadyResolve=resolve),twpChangeListeners=[];
const twpConfigReady=bayanRuntimeSend({type:'twp-config'}).then(data=>{twpSettings=data||{};applyTwpConfig(twpSettings.prefs||{});});
function applyTwpConfig(p){
 const always=bayanLangList(p.alwaysLanguages).map(bayanLangBase).filter(Boolean);
 const never=new Set(bayanLangList(p.neverLanguages).map(bayanLangBase).filter(Boolean));
 const next={targetLanguage:p.pageTarget||'ar',targetLanguages:[p.pageTarget||'ar'],pageTranslatorService:p.pageEngine||'google',customDictionary:new Map(p.customDictionary||[]),dontSortResults:p.dontSortResults?'yes':'no',translateTag_pre:p.translatePre?'yes':'no',translateDynamicallyCreatedContent:p.translateDynamic===false?'no':'yes',autoTranslateWhenClickingALink:p.followTranslationLinks?'yes':'no',alwaysTranslateSites:p.alwaysSites||[],neverTranslateSites:p.neverSites||[],alwaysTranslateLangs:always.filter(lang=>!never.has(lang)),neverTranslateLangs:[...never],enableIframePageTranslation:p.translateFrames===false?'no':'yes',useOldPopup:'no',popupPanelSection:2};
 const old=twpConfigValues;twpConfigValues=next;for(const [key,value]of Object.entries(next))if(old[key]!==value)twpChangeListeners.forEach(fn=>fn(key,value));
}
globalThis.bayanLangBase=bayanLangBase;
globalThis.bayanHasScriptLang=bayanHasScriptLang;
globalThis.bayanTextMatchesLangs=bayanTextMatchesLangs;
globalThis.bayanSelectiveFromSample=bayanSelectiveFromSample;
function bayanSelectiveStopObserver(){
 if(bayanSelectiveObserver){try{bayanSelectiveObserver.disconnect();}catch{}bayanSelectiveObserver=null;}
 clearTimeout(bayanSelectiveTimer);
}
function bayanSelectiveRestore(){
 bayanSelectiveGen++;
 bayanSelectiveStopObserver();
 for(const [node,original] of bayanSelectiveNodes){
  try{if(node&&node.parentNode&&node.textContent!==original)node.textContent=original;}catch{}
 }
 bayanSelectiveNodes.clear();
}
async function bayanTranslateChunk(text,settings){
 const r=await bayanRuntimeSend({type:'page-translate-text',engine:settings.engine||'google',target:settings.target||'ar',source:settings.source||'auto',text});
 return r?.ok&&r.text?r.text:text;
}
function bayanChunkTest(re,text){
 if(!re||!text)return false;
 re.lastIndex=0;
 return re.test(text);
}
async function bayanSelectiveApplyNode(node,settings,chunkRe,gen){
 if(gen!==bayanSelectiveGen||!node||!node.parentNode)return false;
 if(node.parentElement?.closest?.('#bayan-extension-root'))return false;
 const current=String(node.textContent||'');
 if(!current.trim())return false;
 const langs=globalThis.bayanSelectiveLangs||[];
 // Skip if this visible text no longer contains an added script language.
 if(!bayanTextMatchesLangs(current,langs))return false;
 if(!bayanChunkTest(chunkRe,current))return false;
 if(!bayanSelectiveNodes.has(node))bayanSelectiveNodes.set(node,current);
 const original=bayanSelectiveNodes.get(node);
 const parts=String(original).split(chunkRe);
 const out=[];
 for(const part of parts){
  if(gen!==bayanSelectiveGen)return false;
  if(part&&bayanChunkTest(chunkRe,part)){
   twpStats.active++;twpEmit();
   try{out.push(await bayanTranslateChunk(part,settings));twpStats.done++;}
   catch{out.push(part);twpStats.failed++;}
   finally{twpStats.active=Math.max(0,twpStats.active-1);twpEmit();}
  }else out.push(part);
 }
 const next=out.join('');
 if(gen===bayanSelectiveGen&&node.parentNode&&next&&next!==node.textContent)node.textContent=next;
 return true;
}
function bayanSelectiveCollectRoots(){
 const roots=[document.body,document.documentElement].filter(Boolean);
 const host=location.hostname||'';
 if(/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(host)){
  for(const sel of ['#title','ytd-watch-metadata','#description-inline-expander','#contents','ytd-comments','#content-text','#video-title']){
   try{for(const el of document.querySelectorAll(sel))roots.push(el);}catch{}
  }
 }
 return roots;
}
function bayanSelectiveTextNodes(root){
 const out=[];
 if(!root)return out;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
  acceptNode(node){
   if(!node?.textContent?.trim())return NodeFilter.FILTER_REJECT;
   const p=node.parentElement;
   if(!p)return NodeFilter.FILTER_REJECT;
   const tag=p.nodeName.toLowerCase();
   if(['script','style','noscript','textarea','input','code','svg','math'].includes(tag))return NodeFilter.FILTER_REJECT;
   if(p.closest?.('#bayan-extension-root'))return NodeFilter.FILTER_REJECT;
   if(p.isContentEditable)return NodeFilter.FILTER_REJECT;
   return NodeFilter.FILTER_ACCEPT;
  }
 });
 let n;while((n=walker.nextNode()))out.push(n);
 return out;
}
async function bayanSelectiveScan(settings){
 const langs=globalThis.bayanSelectiveLangs||[];
 const chunkRe=bayanSelectiveChunkRegex(langs);
 if(!chunkRe||!langs.length)return;
 const gen=bayanSelectiveGen;
 const seen=new Set();
 for(const root of bayanSelectiveCollectRoots()){
  for(const node of bayanSelectiveTextNodes(root)){
   if(seen.has(node))continue;seen.add(node);
   await bayanSelectiveApplyNode(node,settings,chunkRe,gen);
   if(gen!==bayanSelectiveGen)return;
  }
 }
}
function bayanSelectiveWatch(settings){
 bayanSelectiveStopObserver();
 if(!settings.dynamic&&settings.dynamic!==undefined)return;
 bayanSelectiveObserver=new MutationObserver(()=>{
  clearTimeout(bayanSelectiveTimer);
  bayanSelectiveTimer=setTimeout(()=>{if(twpState==='translated'&&globalThis.bayanSelectiveLangs?.length)bayanSelectiveScan(settings);},400);
 });
 try{bayanSelectiveObserver.observe(document.documentElement,{childList:true,subtree:true,characterData:true});}catch{}
}
async function bayanSelectiveStart(settings){
 bayanSelectiveStopObserver();
 const gen=++bayanSelectiveGen;
 // Keep previously saved originals when re-running the same selective langs.
 twpStats={active:0,done:0,failed:0,engines:[settings.engine||'google'].filter(Boolean)};
 twpState='translated';
 twpEmit();
 // Do NOT call TWP full-page here — it would translate English in the same paragraph.
 await bayanSelectiveScan(settings);
 if(gen!==bayanSelectiveGen)return;
 bayanSelectiveWatch(settings);
 twpEmit();
}
const twpConfig={get:key=>twpConfigValues[key],set:(key,value)=>{twpConfigValues[key]=value;twpChangeListeners.forEach(fn=>fn(key,value));},onReady:()=>twpConfigReady,onChanged:fn=>twpChangeListeners.push(fn)};
document.addEventListener('click',event=>{if(self!==top||!twpSettings.prefs?.followTranslationLinks||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey)return;const a=event.target.closest?.('a[href]');if(a&&(!a.target||a.target==='_self'))bayanRuntimeSend({type:'twp-follow-link',url:a.href});},true);
const showOriginal={isEnabled:false,enable(){this.isEnabled=!!twpSettings.prefs?.showOriginalHover;},disable(){for(const node of twpOriginalNodes)node.removeAttribute('title');twpOriginalNodes=[];this.isEnabled=false;},add(node){node.title=node.textContent;twpOriginalNodes.push(node);},enabledObserverSubscribe(){}};
let twpBgDoneSent=false;
function twpEmit(){
 globalThis.bayanPageStateChanged?.(globalThis.BayanPage?.status());
 if(self!==top||!globalThis.twpBgHiddenTranslate)return;
 const status=globalThis.BayanPage?.status();
 if(!status||status.running||!status.translated||twpBgDoneSent)return;
 if(!(status.done>0||status.remaining===0||status.total===0))return;
 twpBgDoneSent=true;globalThis.twpBgHiddenTranslate=false;
 bayanRuntimeSend({type:'bg-translate-done'});
}
async function twpRun(message){
 const generation=twpBridgeGeneration;twpStats.active++;twpEmit();
 try{
  if(message.action==='translateHTML'){
   if(generation!==twpBridgeGeneration)return [];
   const r=await bayanRuntimeSend({type:'page-translate-html',engine:message.translationService,target:message.targetLanguage,source:message.sourceLanguage,sourceArray2d:message.sourceArray2d,dontSortResults:message.dontSortResults});
   if(generation!==twpBridgeGeneration)return [];
   if(r?.ok&&Array.isArray(r.groups)&&r.groups.length===message.sourceArray2d.length){
    const failed=r.failed||0;twpStats.failed+=failed;twpStats.done+=r.groups.length-failed;if(r.engines?.length)twpStats.engines=[...new Set([...twpStats.engines,...r.engines])];if(failed)twpStats.note=r.error||'تعذرت ترجمة بعض الفقرات.';twpEmit();return r.groups;
   }
   const output=[];for(const pieces of message.sourceArray2d){if(generation!==twpBridgeGeneration)return [];const part=await bayanRuntimeSend({type:'page-translate-pieces',engine:message.translationService,target:message.targetLanguage,source:message.sourceLanguage,pieces,dontSortResults:message.dontSortResults});if(generation!==twpBridgeGeneration)return [];if(!part?.ok){twpStats.failed++;output.push(pieces);twpStats.note=part?.error||'تعذرت ترجمة فقرة.';}else{output.push(part.items);twpStats.engines=[...new Set([...twpStats.engines,part.engine])];}twpStats.done++;twpEmit();}return output;
  }
  const inputs=message.action==='translateText'?message.sourceArray:[message.source];
  const output=await Promise.all(inputs.map(async text=>{if(generation!==twpBridgeGeneration)return text;const r=await bayanRuntimeSend({type:'page-translate-text',engine:message.translationService,target:message.targetLanguage,source:message.sourceLanguage,text});if(!r?.ok){twpStats.failed++;twpStats.note=r?.error||'تعذر ترجمة نص.';}else twpStats.done++;return r?.ok?r.text:text;}));
  if(generation!==twpBridgeGeneration)return message.action==='translateText'?[]:'';
  twpEmit();return message.action==='translateText'?output:output[0];
 }finally{if(generation===twpBridgeGeneration){twpStats.active--;twpEmit();}}
}
const twpBridge={send(message,callback=()=>{}){
 if(['translateHTML','translateText','translateSingleText'].includes(message.action)){twpRun(message).then(callback).catch(e=>{twpStats.note=e.message;twpStats.failed++;callback(message.action==='translateHTML'?message.sourceArray2d:message.action==='translateText'?message.sourceArray:message.source);twpEmit();});return;}
 if(message.action==='getTabHostName'){twpConfigReady.then(()=>callback(twpSettings.host||location.hostname));return;}
 if(message.action==='detectTabLanguage'){chrome.i18n.detectLanguage(document.body?.innerText.slice(0,1200)||'',r=>{
  // Normalize zh-CN / zh_CN / zh-Hans → keep ISO form but always notify background with raw+base.
  const language=r?.languages?.[0]?.language||'und';
  bayanRuntimeSend({type:'twp-language',language,base:bayanLangBase(language)});
  callback(language);
 });return;}
 if(['getMainFrameTabLanguage','getMainFramePageLanguageState'].includes(message.action)){bayanRuntimeSend({type:'twp-main-state'}).then(r=>callback(message.action==='getMainFrameTabLanguage'?r?.language:r?.state));return;}
 if(message.action==='setPageLanguageState'){twpState=message.pageLanguageState;if(self===top)bayanRuntimeSend({type:'twp-state',state:message.pageLanguageState});twpEmit();}
 queueMicrotask(()=>callback());
}};
let twpLocalSettings={},twpState='original';
globalThis.twpBgHiddenTranslate=false;
globalThis.BayanPage={
 status(){
  const remaining=globalThis.twpEngine?.remaining?.()||0;
  const sel=globalThis.bayanSelectiveLangs;
  const selectiveNote=sel?.length?('نصوص '+sel.join('/')+' فقط. '):'';
  return {running:twpStats.active>0,total:globalThis.twpEngine?.total?.()||0,done:twpStats.done,failed:twpStats.failed,remaining,translated:twpState==='translated',selectiveLangs:sel||null,engines:twpStats.engines,note:twpStats.note||(twpState==='original'?'النص الأصلي.':twpState==='paused'?'توقفت الترجمة.':twpStats.active?(selectiveNote+'جارٍ الترجمة…'):remaining?(selectiveNote+'تُترجم بقية النصوص أثناء التمرير.'):(selectiveNote?'اكتملت ترجمة اللغة المضافة.':'اكتملت ترجمة الصفحة.'))};
 },
 start(settings={}){
  twpBridgeGeneration++;twpStats={active:0,done:0,failed:0,engines:[]};twpBgDoneSent=false;twpLocalSettings=settings;twpState='translated';
  const sel=Array.isArray(settings.selectiveLangs)?[...new Set(settings.selectiveLangs.map(bayanLangBase).filter(b=>bayanHasScriptLang(b)))]:[];
  globalThis.bayanSelectiveLangs=sel.length?sel:null;
  // Language-Add path: translate ONLY added script languages (ko/zh/…). Full page button has no selectiveLangs.
  if(sel.length){
   // Restore any prior selective edits, then translate ONLY those script languages.
   bayanSelectiveRestore();
   globalThis.bayanSelectiveLangs=sel;
   bayanSelectiveStart(settings);
   return this.status();
  }
  // Full-page path (toolbar button / site auto): clear selective leftovers first.
  bayanSelectiveRestore();
  globalThis.bayanSelectiveLangs=null;
  twpEngineReady.then(()=>{twpConfig.set('translateDynamicallyCreatedContent',settings.dynamic===false?'no':'yes');globalThis.twpEngine.start(settings);twpEmit();});
  return this.status();
 },
 stop(){twpBridgeGeneration++;twpStats.active=0;twpState='paused';globalThis.twpBgHiddenTranslate=false;bayanSelectiveStopObserver();globalThis.bayanSelectiveLangs=null;globalThis.twpEngine?.stop();twpEmit();return this.status();},
 restore(){twpBridgeGeneration++;twpStats={active:0,done:0,failed:0,engines:[]};twpState='original';globalThis.twpBgHiddenTranslate=false;bayanSelectiveRestore();globalThis.bayanSelectiveLangs=null;globalThis.twpEngine?.restore();twpEmit();return this.status();}
};
function bayanAutoSettings(extra={}){return {engine:twpConfig.get('pageTranslatorService')||'google',target:twpConfig.get('targetLanguage')||'ar',source:'auto',dynamic:twpConfig.get('translateDynamicallyCreatedContent')!=='no',lazy:true,dontSortResults:twpConfig.get('dontSortResults')==='yes',...extra};}
globalThis.bayanRequestBackgroundTranslate=()=>bayanRuntimeSend({type:'bg-translate-request'});
globalThis.bayanNotifyTabVisible=()=>{globalThis.twpBgHiddenTranslate=false;return bayanRuntimeSend({type:'bg-translate-visible'});};
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type==='prefs-updated'){
  twpSettings.prefs=message.prefs;applyTwpConfig(message.prefs||{});
  // Re-check auto-translate when alwaysLanguages changes (e.g. Add zh while page is zh-CN).
  if(self===top){
   const lang=globalThis.twpEngine?.originalLanguage?.()||'und';
   queueMicrotask(()=>{try{globalThis.bayanMaybeAutoTranslate?.(lang);}catch{}});
  }
 }
 if(message.type==='bg-translate-grant'&&self===top){globalThis.twpBgHiddenTranslate=true;twpBgDoneSent=false;BayanPage.start(bayanAutoSettings({...message.settings,lazy:true}));reply({ok:true});}
 if(message.type==='twp-subframe-action'&&self!==top){if(message.action==='start'&&twpSettings.prefs?.translateFrames!==false)BayanPage.start(message.settings);if(message.action==='restore')BayanPage.restore();if(message.action==='stop')BayanPage.stop();reply({ok:true});}
});
