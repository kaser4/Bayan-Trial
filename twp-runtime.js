/* Bayan bridge for the upstream TWP page translator. MPL-2.0. */
'use strict';
const checkedLastError=()=>{void chrome.runtime.lastError;};
const platformInfo={isMobile:{any:false}};
const twpLang={fixTLanguageCode:code=>({ 'zh-cn':'zh-CN','zh-tw':'zh-TW',iw:'he',nb:'no'}[String(code).toLowerCase()]||code)};
let twpSettings={},twpConfigValues={},twpReadyResolve,twpBridgeGeneration=0,twpStats={active:0,done:0,failed:0,engines:[]},twpOriginalNodes=[];
const twpEngineReady=new Promise(resolve=>twpReadyResolve=resolve),twpChangeListeners=[];
const twpConfigReady=chrome.runtime.sendMessage({type:'twp-config'}).then(data=>{twpSettings=data||{};applyTwpConfig(twpSettings.prefs||{});});
function applyTwpConfig(p){const next={targetLanguage:p.pageTarget||'ar',targetLanguages:[p.pageTarget||'ar'],pageTranslatorService:p.pageEngine||'google',customDictionary:new Map(p.customDictionary||[]),dontSortResults:p.dontSortResults?'yes':'no',translateTag_pre:p.translatePre?'yes':'no',translateDynamicallyCreatedContent:p.translateDynamic===false?'no':'yes',autoTranslateWhenClickingALink:p.followTranslationLinks?'yes':'no',alwaysTranslateSites:p.alwaysSites||[],neverTranslateSites:p.neverSites||[],alwaysTranslateLangs:(p.alwaysLanguages||[]).filter(lang=>!(p.neverLanguages||[]).includes(lang)),neverTranslateLangs:p.neverLanguages||[],enableIframePageTranslation:p.translateFrames===false?'no':'yes',useOldPopup:'no',popupPanelSection:2};const old=twpConfigValues;twpConfigValues=next;for(const [key,value]of Object.entries(next))if(old[key]!==value)twpChangeListeners.forEach(fn=>fn(key,value));}
const twpConfig={get:key=>twpConfigValues[key],set:(key,value)=>{twpConfigValues[key]=value;twpChangeListeners.forEach(fn=>fn(key,value));},onReady:()=>twpConfigReady,onChanged:fn=>twpChangeListeners.push(fn)};
document.addEventListener('click',event=>{if(self!==top||!twpSettings.prefs?.followTranslationLinks||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey)return;const a=event.target.closest?.('a[href]');if(a&&(!a.target||a.target==='_self'))chrome.runtime.sendMessage({type:'twp-follow-link',url:a.href}).catch(()=>{});},true);
const showOriginal={isEnabled:false,enable(){this.isEnabled=!!twpSettings.prefs?.showOriginalHover;},disable(){for(const node of twpOriginalNodes)node.removeAttribute('title');twpOriginalNodes=[];this.isEnabled=false;},add(node){node.title=node.textContent;twpOriginalNodes.push(node);},enabledObserverSubscribe(){}};
function twpEmit(){globalThis.bayanPageStateChanged?.(globalThis.BayanPage?.status());}
async function twpRun(message){
 const generation=twpBridgeGeneration;twpStats.active++;twpEmit();
 try{
  if(message.action==='translateHTML'){
   if(generation!==twpBridgeGeneration)return [];
   const r=await chrome.runtime.sendMessage({type:'page-translate-html',engine:message.translationService,target:message.targetLanguage,source:message.sourceLanguage,sourceArray2d:message.sourceArray2d,dontSortResults:message.dontSortResults});
   if(generation!==twpBridgeGeneration)return [];
   if(r?.ok&&Array.isArray(r.groups)&&r.groups.length===message.sourceArray2d.length){
    const failed=r.failed||0;twpStats.failed+=failed;twpStats.done+=r.groups.length-failed;if(r.engines?.length)twpStats.engines=[...new Set([...twpStats.engines,...r.engines])];if(failed)twpStats.note=r.error||'تعذرت ترجمة بعض الفقرات.';twpEmit();return r.groups;
   }
   const output=[];for(const pieces of message.sourceArray2d){if(generation!==twpBridgeGeneration)return [];const part=await chrome.runtime.sendMessage({type:'page-translate-pieces',engine:message.translationService,target:message.targetLanguage,source:message.sourceLanguage,pieces,dontSortResults:message.dontSortResults});if(generation!==twpBridgeGeneration)return [];if(!part?.ok){twpStats.failed++;output.push(pieces);twpStats.note=part?.error||'تعذرت ترجمة فقرة.';}else{output.push(part.items);twpStats.engines=[...new Set([...twpStats.engines,part.engine])];}twpStats.done++;twpEmit();}return output;
  }
  const inputs=message.action==='translateText'?message.sourceArray:[message.source];
  const output=await Promise.all(inputs.map(async text=>{if(generation!==twpBridgeGeneration)return text;const r=await chrome.runtime.sendMessage({type:'page-translate-text',engine:message.translationService,target:message.targetLanguage,source:message.sourceLanguage,text});if(!r?.ok){twpStats.failed++;twpStats.note=r?.error||'تعذر ترجمة نص.';}else twpStats.done++;return r?.ok?r.text:text;}));
  if(generation!==twpBridgeGeneration)return message.action==='translateText'?[]:'';
  twpEmit();return message.action==='translateText'?output:output[0];
 }finally{if(generation===twpBridgeGeneration){twpStats.active--;twpEmit();}}
}
const twpBridge={send(message,callback=()=>{}){
 if(['translateHTML','translateText','translateSingleText'].includes(message.action)){twpRun(message).then(callback).catch(e=>{twpStats.note=e.message;twpStats.failed++;callback(message.action==='translateHTML'?message.sourceArray2d:message.action==='translateText'?message.sourceArray:message.source);twpEmit();});return;}
 if(message.action==='getTabHostName'){twpConfigReady.then(()=>callback(twpSettings.host||location.hostname));return;}
 if(message.action==='detectTabLanguage'){chrome.i18n.detectLanguage(document.body?.innerText.slice(0,1200)||'',r=>{const language=r?.languages?.[0]?.language||'und';chrome.runtime.sendMessage({type:'twp-language',language}).catch(()=>{});callback(language);});return;}
 if(['getMainFrameTabLanguage','getMainFramePageLanguageState'].includes(message.action)){chrome.runtime.sendMessage({type:'twp-main-state'}).then(r=>callback(message.action==='getMainFrameTabLanguage'?r?.language:r?.state));return;}
 if(message.action==='setPageLanguageState'){twpState=message.pageLanguageState;if(self===top)chrome.runtime.sendMessage({type:'twp-state',state:message.pageLanguageState}).catch(()=>{});twpEmit();}
 queueMicrotask(()=>callback());
}};
let twpLocalSettings={},twpState='original';
globalThis.BayanPage={
 status(){const remaining=globalThis.twpEngine?.remaining?.()||0;return {running:twpStats.active>0,total:globalThis.twpEngine?.total?.()||0,done:twpStats.done,failed:twpStats.failed,remaining,translated:twpState==='translated',engines:twpStats.engines,note:twpStats.note||(twpState==='original'?'النص الأصلي.':twpState==='paused'?'توقفت الترجمة.':twpStats.active?'جارٍ ترجمة الصفحة…':remaining?'تُترجم بقية الصفحة أثناء التمرير.':'اكتملت ترجمة الصفحة.')};},
 start(settings={}){twpBridgeGeneration++;twpStats={active:0,done:0,failed:0,engines:[]};twpLocalSettings=settings;twpState='translated';twpEngineReady.then(()=>{twpConfig.set('translateDynamicallyCreatedContent',settings.dynamic===false?'no':'yes');globalThis.twpEngine.start(settings);twpEmit();});return this.status();},
 stop(){twpBridgeGeneration++;twpStats.active=0;twpState='paused';globalThis.twpEngine?.stop();twpEmit();return this.status();},
 restore(){twpBridgeGeneration++;twpStats={active:0,done:0,failed:0,engines:[]};twpState='original';globalThis.twpEngine?.restore();twpEmit();return this.status();}
};
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type==='prefs-updated'){twpSettings.prefs=message.prefs;applyTwpConfig(message.prefs||{});}
 if(message.type==='twp-subframe-action'&&self!==top){if(message.action==='start'&&twpSettings.prefs?.translateFrames!==false)BayanPage.start(message.settings);if(message.action==='restore')BayanPage.restore();if(message.action==='stop')BayanPage.stop();reply({ok:true});}
});
