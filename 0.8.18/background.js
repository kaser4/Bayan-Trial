'use strict';
importScripts('web-services.js','speech.js');
const bridgeRequests=new Map();
const twpTabs=new Map();
const twpStateReady=chrome.storage.session.get('twpTabStates').then(({twpTabStates=[]})=>{for(const [id,state]of twpTabStates)if(!twpTabs.has(id))Map.prototype.set.call(twpTabs,id,state);});
const rememberTwpState=(id,state)=>{Map.prototype.set.call(twpTabs,id,state);chrome.storage.session.set({twpTabStates:[...twpTabs]}).catch(()=>{});return twpTabs;};
const bgTranslateQueue={activeId:null,waiting:[]};
const langDetectCache=new Map();
async function bgTranslateSettings(){
 const {prefs={}}=await chrome.storage.local.get('prefs');
 return {engine:prefs.pageEngine||'google',target:prefs.pageTarget||'ar',source:prefs.pageSource||'auto',dynamic:prefs.translateDynamic!==false,lazy:true,dontSortResults:!!prefs.dontSortResults};
}
async function bgTranslateGrant(tabId){
 try{
  const settings=await bgTranslateSettings();
  await chrome.tabs.sendMessage(tabId,{type:'bg-translate-grant',settings},{frameId:0});
 }catch{
  bgTranslateRelease(tabId);
 }
}
function bgTranslatePromote(){
 if(bgTranslateQueue.activeId!=null)return;
 while(bgTranslateQueue.waiting.length){
  const next=bgTranslateQueue.waiting.shift();
  if(!next)continue;
  bgTranslateQueue.activeId=next;
  bgTranslateGrant(next);
  return;
 }
}
function bgTranslateEnqueue(tabId){
 if(!Number.isInteger(tabId))return;
 if(bgTranslateQueue.activeId===tabId||bgTranslateQueue.waiting.includes(tabId))return;
 if(bgTranslateQueue.activeId==null){bgTranslateQueue.activeId=tabId;bgTranslateGrant(tabId);return;}
 bgTranslateQueue.waiting.push(tabId);
}
function bgTranslateRelease(tabId){
 if(!Number.isInteger(tabId))return;
 bgTranslateQueue.waiting=bgTranslateQueue.waiting.filter(id=>id!==tabId);
 if(bgTranslateQueue.activeId===tabId){bgTranslateQueue.activeId=null;bgTranslatePromote();}
}
function bgTranslateOnVisible(tabId){
 if(!Number.isInteger(tabId))return;
 bgTranslateQueue.waiting=bgTranslateQueue.waiting.filter(id=>id!==tabId);
 if(bgTranslateQueue.activeId===tabId){bgTranslateQueue.activeId=null;bgTranslatePromote();}
}
chrome.tabs.onRemoved.addListener(tabId=>{bgTranslateRelease(tabId);langDetectCache.delete(tabId);});
function bridge(id){
 if(!bridgeRequests.has(id))bridgeRequests.set(id,(async()=>{const name=`bridge-${id}`,stored=await chrome.storage.session.get(name);const token=stored[name]||crypto.randomUUID();if(!stored[name])await chrome.storage.session.set({[name]:token});return token;})());
 return bridgeRequests.get(id);
}
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
chrome.runtime.onInstalled.addListener(details => {
  chrome.storage.local.get('prefs').then(({prefs={}})=>chrome.storage.local.set({prefs:{...prefs,readingSize:prefs.readingSize||prefs.originalFontSize||prefs.fontSize||18,buttonSize:40,buttonColor:'#000000',iconColor:'#ffffff',opacity:.75,controlsSize:130,originalFontSize:prefs.readingSize||prefs.originalFontSize||prefs.fontSize||18,translationFontSize:prefs.readingSize||prefs.originalFontSize||prefs.fontSize||18,...(!details.previousVersion||parseFloat(details.previousVersion)<.4?{engine:'google',speechMode:'google'}:{}),...(!details.previousVersion||details.previousVersion.startsWith('0.1.')?{onlySelection:true,panelW:620,panelH:430}: {})}}));
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({id: 'bayan-translate', title: 'بيان: ترجمة النص المحدد', contexts: ['selection']}));
});
function galleryBlocked(url=''){
 try{
  const parsed=new URL(url);
  if(parsed.hostname==='chromewebstore.google.com')return true;
  if(parsed.hostname==='chrome.google.com'&&parsed.pathname.startsWith('/webstore'))return true;
  if(parsed.hostname==='microsoftedge.microsoft.com'&&parsed.pathname.startsWith('/addons'))return true;
 }catch{}
 return /^(chrome|edge|vivaldi|about|chrome-extension|devtools|view-source):/.test(url);
}
async function openTranslator(text){
 const id=crypto.randomUUID();
 await chrome.storage.session.set({bayanPendingText:{id,text:String(text||'').slice(0,12000)}});
 const target=chrome.runtime.getURL('app.html?pending='+id);
 try{await chrome.windows.create({url:target,type:'popup',width:640,height:560});}
 catch{await chrome.tabs.create({url:target});}
}
async function openSelection(tab,text){
 if(tab?.id&&!galleryBlocked(tab.url||'')){
  try{await chrome.tabs.sendMessage(tab.id,{type:'open',text});return;}catch{}
 }
 await openTranslator(text);
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'bayan-translate') openSelection(tab, info.selectionText);
});
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'translate-selection') return;
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  await openSelection(tab,'');
});
async function translate(input){return translateWeb(input);}
let fgTranslateJobs=0;
let bgTranslateJobs=Promise.resolve();
function runPageTranslateJob(isForeground,fn){
 if(isForeground){
  fgTranslateJobs++;
  return Promise.resolve().then(fn).finally(()=>{fgTranslateJobs=Math.max(0,fgTranslateJobs-1);});
 }
 const job=bgTranslateJobs.then(async()=>{
  while(fgTranslateJobs>0)await new Promise(resolve=>setTimeout(resolve,40));
  return fn();
 });
 bgTranslateJobs=job.then(()=>{},()=>{});
 return job;
}
function withTimeout(promise,ms,fallback){
 return Promise.race([promise,new Promise(resolve=>setTimeout(()=>resolve(fallback),ms))]);
}
function detectLanguagesFromText(text='',htmlLang=''){
 const sample=String(text||'');
 return new Promise(resolve=>{
  const finish=languages=>{
   // Use RegExp source strings (avoid regex-literal bracket pitfalls in this file).
   const scriptTests=[['zh','[\\u4e00-\\u9fff]'],['ja','[\\u3040-\\u30ff]'],['ko','[\\uac00-\\ud7af]'],['ar','[\\u0600-\\u06ff]'],['ru','[\\u0400-\\u04ff]'],['he','[\\u0590-\\u05ff]'],['hi','[\\u0900-\\u097f]'],['th','[\\u0e00-\\u0e7f]']];
   for(const [code,source] of scriptTests){
    const hits=(sample.match(new RegExp(source,'g'))||[]).length;
    if(!hits)continue;
    const row=languages.find(l=>l.code===code);
    if(row){row.scriptHits=hits;row.hint=true;}
    else languages.push({code,percentage:0,hint:true,scriptHits:hits});
   }
   const attr=String(htmlLang||'').toLowerCase().split('-')[0];
   if(attr&&/^[a-z]{2,3}$/.test(attr)&&attr!=='und'&&!languages.some(l=>l.code===attr))languages.unshift({code:attr,percentage:0,hint:true,scriptHits:0});
   if(!languages.length){
    const compact=sample.replace(/\s+/g,' ').trim();
    const latin=(compact.match(/[A-Za-z]/g)||[]).length;
    if(compact.length>=20&&latin>=20&&latin/Math.max(1,compact.length)>0.3)languages.push({code:'en',percentage:0,hint:true,scriptHits:0});
   }
   // Script-heavy languages (e.g. Russian Cyrillic) win over English % when the page was translated to English.
   languages.sort((a,b)=>(b.scriptHits||0)-(a.scriptHits||0)||(b.percentage||0)-(a.percentage||0));
   let language=languages[0]?.code||'und';
   const strong=languages.find(l=>(l.scriptHits||0)>=40);
   if(strong)language=strong.code;
   resolve({languages,language});
  };
  if(!sample.trim()&&!htmlLang){resolve({languages:[],language:'und'});return;}
  try{
   chrome.i18n.detectLanguage(sample.slice(0,12000),result=>{
    const languages=[];
    for(const item of result?.languages||[]){
     const code=String(item.language||'').toLowerCase().split('-')[0];
     if(!code||code==='und'||!(item.percentage>=1))continue;
     if(!languages.some(l=>l.code===code))languages.push({code,percentage:Math.round(item.percentage||0),hint:false,scriptHits:0});
    }
    finish(languages);
   });
  }catch{finish([]);}
 });
}
async function readTabContent(tabId){
 if(!chrome.scripting?.executeScript)return {text:'',lang:'',originalLang:''};
 const results=await chrome.scripting.executeScript({
  target:{tabId,frameIds:[0]},
  func:()=>{
   const eng=globalThis.twpEngine;
   const fromEngine=(typeof eng?.detectionSample==='function'&&eng.detectionSample())||'';
   const text=String(fromEngine||((document.body&&document.body.innerText)||(document.documentElement&&document.documentElement.innerText)||'')).slice(0,12000);
   const originalLang=String((typeof eng?.originalLanguage==='function'&&eng.originalLanguage())||'').toLowerCase();
   const lang=String(document.documentElement.getAttribute('lang')||document.documentElement.lang||document.querySelector('meta[http-equiv="content-language"]')?.content||'').toLowerCase();
   return {text,lang,originalLang};
  }
 });
 return results?.[0]?.result||{text:'',lang:'',originalLang:''};
}
async function detectTabLanguages(tabId,force=false){
 const cached=langDetectCache.get(tabId);
 if(!force&&cached&&Date.now()-cached.at<8000)return cached.result;
 const page=await withTimeout(readTabContent(tabId),2500,{text:'',lang:'',originalLang:''});
 const detected=await withTimeout(detectLanguagesFromText(page.text||'',page.lang||''),2000,{languages:[],language:'und'});
 const original=String(page.originalLang||'').toLowerCase().split('-')[0];
 if(original&&original!=='und'&&/^[a-z]{2,3}$/.test(original)){
  const idx=detected.languages.findIndex(l=>l.code===original);
  if(idx>0){const [row]=detected.languages.splice(idx,1);detected.languages.unshift(row);}
  else if(idx<0)detected.languages.unshift({code:original,percentage:0,hint:true,scriptHits:0});
  // Prefer the page's original language over post-translation English.
  if(!(detected.languages[0]?.scriptHits>0&&detected.languages[0].code!==original))detected.language=original;
 }
 const prev=twpTabs.get(tabId)?.language;
 const {prefs={}}=await chrome.storage.local.get('prefs');
 const target=String(prefs.pageTarget||'ar').toLowerCase().split('-')[0];
 if(detected.language===target&&prev&&prev!=='und'&&prev!==target)detected.language=prev;
 if(detected.language&&detected.language!=='und'&&!(detected.language===target&&prev&&prev!==target&&prev!=='und')){
  rememberTwpState(tabId,{...twpTabs.get(tabId),language:detected.language});
 }
 langDetectCache.set(tabId,{at:Date.now(),result:detected});
 return detected;
}
async function resolveTargetTab(message,sender){
 if(Number.isInteger(message.tabId)){
  try{return await chrome.tabs.get(message.tabId);}catch{}
 }
 if(sender.tab&&/^https?:/.test(sender.tab.url||''))return sender.tab;
 for(const query of [{active:true,lastFocusedWindow:true},{active:true,currentWindow:true}]){
  const [tab]=await chrome.tabs.query(query);
  if(tab?.id&&/^https?:/.test(tab.url||''))return tab;
 }
 return null;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const isApp = sender.url?.startsWith(chrome.runtime.getURL('app.html'));
  if(message.type==='twp-config'&&sender.tab){
    (async()=>{await twpStateReady;const {prefs={},siteRules={}}=await chrome.storage.local.get(['prefs','siteRules']);const url=new URL(sender.tab.url||sender.url),rule=siteRules[url.origin];const pageKeys=['pageEngine','pageTarget','pageSource','translateDynamic','translateFrames','translatePre','dontSortResults','showOriginalHover','followTranslationLinks','alwaysSites','neverSites','alwaysLanguages','neverLanguages','customDictionary'];const p={};for(const key of pageKeys)if(prefs[key]!==undefined)p[key]=prefs[key];p.alwaysSites=[...new Set([...(p.alwaysSites||[]),...Object.keys(siteRules).map(u=>{try{return new URL(u).hostname;}catch{return '';}})])].filter(host=>host&&!(p.neverSites||[]).includes(host));if(rule){p.pageEngine=rule.engine;p.pageTarget=rule.target;}const state=twpTabs.get(sender.tab.id),follow=sender.frameId===0&&p.followTranslationLinks&&state?.followUntil>Date.now()&&state?.followUrl?.split('#')[0]===url.href.split('#')[0]&&!(p.neverSites||[]).includes(url.hostname);if(follow)delete state.followUntil;if(sender.frameId===0)rememberTwpState(sender.tab.id,{...twpTabs.get(sender.tab.id),state:'original',manualUntil:0});respond({prefs:p,host:url.hostname,follow});})().catch(()=>respond({prefs:{},host:''}));return true;
  }
  if(message.type==='twp-follow-link'&&sender.tab&&sender.frameId===0){const state=twpTabs.get(sender.tab.id)||{};if(state.state==='translated'&&/^https?:/.test(message.url||''))rememberTwpState(sender.tab.id,{...state,followUrl:message.url,followUntil:Date.now()+20000});respond({ok:true});return;}
  if(message.type==='twp-state'&&sender.tab){if(sender.frameId===0){const old=twpTabs.get(sender.tab.id)||{};rememberTwpState(sender.tab.id,{...old,state:message.state});if(!(old.manualUntil>Date.now()))chrome.storage.local.get('prefs').then(({prefs={}})=>{if(message.state==='translated'&&prefs.translateFrames!==false&&sender.tab.active)chrome.tabs.sendMessage(sender.tab.id,{type:'twp-subframe-action',action:'start',settings:{engine:prefs.pageEngine||'google',target:prefs.pageTarget||'ar',source:prefs.pageSource||'auto',dynamic:prefs.translateDynamic!==false,lazy:prefs.lazyPage!==false,dontSortResults:!!prefs.dontSortResults}}).catch(()=>{});else if(message.state==='original')chrome.tabs.sendMessage(sender.tab.id,{type:'twp-subframe-action',action:'restore'}).catch(()=>{});});}respond({ok:true});return;}
  if(message.type==='twp-language'&&sender.tab){if(sender.frameId===0)rememberTwpState(sender.tab.id,{...twpTabs.get(sender.tab.id),language:message.language});respond({ok:true});return;}
  if(message.type==='twp-main-state'&&sender.tab){twpStateReady.then(()=>respond(twpTabs.get(sender.tab.id)||{state:'original',language:'und'}));return true;}
  if(message.type==='bg-translate-request'&&sender.tab&&sender.frameId===0){bgTranslateEnqueue(sender.tab.id);respond({ok:true,queued:bgTranslateQueue.activeId!==sender.tab.id,activeId:bgTranslateQueue.activeId});return;}
  if(message.type==='bg-translate-visible'&&sender.tab&&sender.frameId===0){bgTranslateOnVisible(sender.tab.id);respond({ok:true});return;}
  if(message.type==='bg-translate-done'&&sender.tab&&sender.frameId===0){bgTranslateRelease(sender.tab.id);respond({ok:true});return;}
  if (message.type === 'layout-get' || (message.type === 'bridge-token' && isApp)) {
    (async()=>{
      const token=await bridge(String(sender.tab?.id || 0));
      const {prefs={}}=await chrome.storage.local.get('prefs');
      const {siteRules={}}=await chrome.storage.local.get('siteRules');let rule;try{rule=siteRules[new URL(sender.tab?.url||'').origin];}catch{}
      respond(message.type==='bridge-token'?{token}:{...prefs,bridgeToken:token});
    })(); return true;
  }
  if (message.type === 'layout-set') {
    (async()=>{
      const patch={};
      for(const key of ['buttonX','buttonY','panelX','panelY'])if(Number.isFinite(message.patch?.[key]))patch[key]=Math.max(0,Math.min(1,message.patch[key]));
      for(const key of ['panelW','panelH'])if(Number.isFinite(message.patch?.[key]))patch[key]=Math.max(280,Math.min(2000,message.patch[key]));
      for(const key of ['windowOffsetX','windowOffsetY'])if(Number.isFinite(message.patch?.[key]))patch[key]=Math.max(-2000,Math.min(2000,message.patch[key]));
      if(typeof message.patch?.buttonCustom==='boolean')patch.buttonCustom=message.patch.buttonCustom;
      const {prefs={}}=await chrome.storage.local.get('prefs');
      const next={...prefs,...patch};if(message.patch?.resetPanelOffset){delete next.windowOffsetX;delete next.windowOffsetY;}await chrome.storage.local.set({prefs:next});respond({ok:true});
    })();return true;
  }
  if (message.type === 'translate' && isApp) {
    translate(message).then(result => respond({ok:true,...result})).catch(error => respond({ok:false,error:error.message}));
    return true;
  }
  if(['page-translate-text','page-translate-pieces','page-translate-html'].includes(message.type)&&sender.tab&&(/^https?:/.test(sender.url||'')||(/^about:(blank|srcdoc)/.test(sender.url||'')&&/^https?:/.test(sender.origin||'')))){
    const isForeground=!!sender.tab.active;
    const payload={...message,bayanPriority:isForeground?'high':'low'};
    runPageTranslateJob(isForeground,()=>message.type==='page-translate-html'?translatePageHtml(payload):message.type==='page-translate-pieces'?translatePagePieces(payload):translate(payload)).then(r=>respond({ok:true,...r})).catch(e=>respond({ok:false,error:e.message}));return true;
  }
  if(message.type==='page-action'&&isApp){
    (async()=>{
      await twpStateReady;
      const tab=await resolveTargetTab(message,sender);
      if(galleryBlocked(tab?.url||''))throw Error('المتصفح يمنع ترجمة الصفحة داخل متجر الإضافات. حدد النص، ثم اختر «بيان: ترجمة النص المحدد» من القائمة اليمنى.');
      if(!tab?.id||!/^https?:/.test(tab.url||''))throw Error('افتح صفحة ويب عادية أولًا؛ صفحات المتصفح وملفات PDF الداخلية غير مدعومة.');
      const {siteRules={},prefs={}}=await chrome.storage.local.get(['siteRules','prefs']),origin=new URL(tab.url).origin,host=new URL(tab.url).hostname;
      const settings={engine:['google','bing','yandex','deepl'].includes(message.engine)?message.engine:'google',target:message.target==='en'?'en':'ar',source:message.source||prefs.pageSource||'auto',dynamic:message.dynamic!==false,lazy:message.lazy!==false,dontSortResults:!!prefs.dontSortResults};
      const pageFlags=(extra={})=>{const language=extra.language||twpTabs.get(tab.id)?.language||'und';const base=String(language).toLowerCase().split('-')[0];const always=(prefs.alwaysLanguages||[]).map(l=>String(l).toLowerCase());return{siteEnabled:!(prefs.neverSites||[]).includes(host)&&(!!siteRules[origin]||(prefs.alwaysSites||[]).includes(host)),neverEnabled:(prefs.neverSites||[]).includes(host),language,languageEnabled:language!=='und'&&always.some(l=>l===language.toLowerCase()||l===base||l.startsWith(base+'-'))};};
      async function ensureContentScripts(){
        if(!chrome.scripting?.executeScript)return false;
        await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},files:['twp-runtime.js','twp-page-translator.js','content.js']});
        await new Promise(resolve=>setTimeout(resolve,150));
        return true;
      }
      async function sendPageAction(action){
        try{return await chrome.tabs.sendMessage(tab.id,{type:'page-action',action,settings},{frameId:0});}
        catch(error){
          if(!/Receiving end|Could not establish/i.test(error.message||''))throw error;
          if(!(await ensureContentScripts()))throw error;
          return chrome.tabs.sendMessage(tab.id,{type:'page-action',action,settings},{frameId:0});
        }
      }
      async function runPageAction(action){
        if(action!=='status')rememberTwpState(tab.id,{...twpTabs.get(tab.id),manualUntil:Date.now()+3000});
        const state=await sendPageAction(action);
        if(state?.language&&state.language!=='und')rememberTwpState(tab.id,{...twpTabs.get(tab.id),language:state.language});
        if(action!=='status'){
          rememberTwpState(tab.id,{...twpTabs.get(tab.id),state:action==='start'?'translated':action==='stop'?'paused':'original',settings});
          chrome.tabs.sendMessage(tab.id,{type:'twp-subframe-action',action:action==='start'&&prefs.translateFrames===false?'restore':action,settings}).catch(()=>{});
        }
        return state;
      }
      if(message.action==='site-rule'){if(message.enabled){siteRules[origin]=settings;prefs.neverSites=(prefs.neverSites||[]).filter(s=>s!==host);}else{delete siteRules[origin];prefs.alwaysSites=(prefs.alwaysSites||[]).filter(s=>s!==host);}await chrome.storage.local.set({siteRules,prefs});let state={};if(message.enabled)state=await runPageAction('start');else state=await runPageAction('status').catch(()=>({}));respond({ok:true,...state,...pageFlags(state)});return;}
      if(message.action==='language-rule'){const language=(message.language||twpTabs.get(tab.id)?.language||'und');const code=String(language).toLowerCase();if(message.enabled&&(code==='und'||!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(code)))throw Error('لم تُكتشف لغة الصفحة بعد. انتظر لحظة ثم أعد المحاولة.');prefs.alwaysLanguages=[...(prefs.alwaysLanguages||[])];prefs.neverLanguages=[...(prefs.neverLanguages||[])];const base=code.split('-')[0];const match=l=>{l=String(l).toLowerCase();return l===code||l===base||l.startsWith(base+'-');};if(message.enabled){if(!prefs.alwaysLanguages.some(match))prefs.alwaysLanguages.push(base);prefs.neverLanguages=prefs.neverLanguages.filter(l=>!match(l));prefs.neverSites=(prefs.neverSites||[]).filter(s=>s!==host);}else prefs.alwaysLanguages=prefs.alwaysLanguages.filter(l=>!match(l));await chrome.storage.local.set({prefs,siteRules});let state={};if(message.enabled&&!message.addOnly)state=await runPageAction('start');else state=await runPageAction('status').catch(()=>({}));respond({ok:true,...state,...pageFlags({...state,language:base})});return;}
      if(message.action==='site-policy'){prefs.neverSites=(prefs.neverSites||[]).filter(s=>s!==host);prefs.alwaysSites=(prefs.alwaysSites||[]).filter(s=>s!==host);delete siteRules[origin];if(message.policy==='never')prefs.neverSites.push(host);await chrome.storage.local.set({prefs,siteRules});if(message.policy==='never'){await sendPageAction('restore').catch(()=>{});chrome.tabs.sendMessage(tab.id,{type:'twp-subframe-action',action:'restore'}).catch(()=>{});}respond({ok:true,...pageFlags(),siteEnabled:false,neverEnabled:message.policy==='never'});return;}
      if(message.action==='detect-languages'){
        const detected=await detectTabLanguages(tab.id,true);
        respond({ok:true,...pageFlags(detected),pageLanguages:detected.languages||[]});
        return;
      }
      if(!['start','stop','restore','status'].includes(message.action))throw Error('أمر غير معروف.');
      // Keep translate start/stop/restore on the original path — do not block them with language scanning.
      const state=await runPageAction(message.action);
      let detected=null;
      if(message.action==='status')detected=await detectTabLanguages(tab.id).catch(()=>null);
      if(detected?.language&&detected.language!=='und')rememberTwpState(tab.id,{...twpTabs.get(tab.id),language:detected.language});
      respond({ok:true,...state,...pageFlags(detected||state),pageLanguages:detected?.languages||state.pageLanguages||[]});
    })().catch(e=>respond({ok:false,error:e.message.includes('Receiving end')?'حدّث صفحة الموقع بعد إعادة تحميل الإضافة ثم حاول مجددًا.':e.message}));return true;
  }
  if (message.type === 'voices' && isApp) { chrome.tts.getVoices(voices => respond(voices)); return true; }
  if (message.type === 'speak' && isApp) {
    readSpeech(message).then(respond).catch(error=>respond({ok:false,error:error.message}));return true;
  }
  if ((message.type === 'stop' && isApp) || (message.type==='stop-page-speech' && sender.tab))cancelSpeech();
});
chrome.storage.onChanged.addListener(async(changes,area)=>{
  if(area!=='local'||!changes.prefs)return;
  const tabs=await chrome.tabs.query({});
  for(const tab of tabs)if(tab.id)chrome.tabs.sendMessage(tab.id,{type:'prefs-updated',prefs:changes.prefs.newValue||{}}).catch(()=>{});
});
