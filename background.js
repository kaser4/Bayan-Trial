'use strict';
importScripts('web-services.js','speech.js');
const bridgeRequests=new Map();
const twpTabs=new Map();
const twpStateReady=chrome.storage.session.get('twpTabStates').then(({twpTabStates=[]})=>{for(const [id,state]of twpTabStates)if(!twpTabs.has(id))Map.prototype.set.call(twpTabs,id,state);});
const rememberTwpState=(id,state)=>{Map.prototype.set.call(twpTabs,id,state);chrome.storage.session.set({twpTabStates:[...twpTabs]}).catch(()=>{});return twpTabs;};
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
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const isApp = sender.url?.startsWith(chrome.runtime.getURL('app.html'));
  if(message.type==='twp-config'&&sender.tab){
    (async()=>{await twpStateReady;const {prefs={},siteRules={}}=await chrome.storage.local.get(['prefs','siteRules']);const url=new URL(sender.tab.url||sender.url),rule=siteRules[url.origin];const pageKeys=['pageEngine','pageTarget','pageSource','translateDynamic','translateFrames','translatePre','dontSortResults','showOriginalHover','followTranslationLinks','alwaysSites','neverSites','alwaysLanguages','neverLanguages','customDictionary'];const p={};for(const key of pageKeys)if(prefs[key]!==undefined)p[key]=prefs[key];p.alwaysSites=[...new Set([...(p.alwaysSites||[]),...Object.keys(siteRules).map(u=>{try{return new URL(u).hostname;}catch{return '';}})])].filter(host=>host&&!(p.neverSites||[]).includes(host));if(rule){p.pageEngine=rule.engine;p.pageTarget=rule.target;}const state=twpTabs.get(sender.tab.id),follow=sender.frameId===0&&p.followTranslationLinks&&state?.followUntil>Date.now()&&state?.followUrl?.split('#')[0]===url.href.split('#')[0]&&!(p.neverSites||[]).includes(url.hostname);if(follow)delete state.followUntil;if(sender.frameId===0)rememberTwpState(sender.tab.id,{...twpTabs.get(sender.tab.id),state:'original',manualUntil:0});respond({prefs:p,host:url.hostname,follow});})().catch(()=>respond({prefs:{},host:''}));return true;
  }
  if(message.type==='twp-follow-link'&&sender.tab&&sender.frameId===0){const state=twpTabs.get(sender.tab.id)||{};if(state.state==='translated'&&/^https?:/.test(message.url||''))rememberTwpState(sender.tab.id,{...state,followUrl:message.url,followUntil:Date.now()+20000});respond({ok:true});return;}
  if(message.type==='twp-state'&&sender.tab){if(sender.frameId===0){const old=twpTabs.get(sender.tab.id)||{};rememberTwpState(sender.tab.id,{...old,state:message.state});if(!(old.manualUntil>Date.now()))chrome.storage.local.get('prefs').then(({prefs={}})=>{if(message.state==='translated'&&prefs.translateFrames!==false)chrome.tabs.sendMessage(sender.tab.id,{type:'twp-subframe-action',action:'start',settings:{engine:prefs.pageEngine||'google',target:prefs.pageTarget||'ar',source:prefs.pageSource||'auto',dynamic:prefs.translateDynamic!==false,lazy:prefs.lazyPage!==false,dontSortResults:!!prefs.dontSortResults}}).catch(()=>{});else if(message.state==='original')chrome.tabs.sendMessage(sender.tab.id,{type:'twp-subframe-action',action:'restore'}).catch(()=>{});});}respond({ok:true});return;}
  if(message.type==='twp-language'&&sender.tab){if(sender.frameId===0)rememberTwpState(sender.tab.id,{...twpTabs.get(sender.tab.id),language:message.language});respond({ok:true});return;}
  if(message.type==='twp-main-state'&&sender.tab){twpStateReady.then(()=>respond(twpTabs.get(sender.tab.id)||{state:'original',language:'und'}));return true;}
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
    (message.type==='page-translate-html'?translatePageHtml(message):message.type==='page-translate-pieces'?translatePagePieces(message):translate(message)).then(r=>respond({ok:true,...r})).catch(e=>respond({ok:false,error:e.message}));return true;
  }
  if(message.type==='page-action'&&isApp){
    (async()=>{
      await twpStateReady;let tab;if(Number.isInteger(message.tabId))tab=await chrome.tabs.get(message.tabId);else if(sender.tab&&/^https?:/.test(sender.tab.url||''))tab=sender.tab;else [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(galleryBlocked(tab?.url||''))throw Error('المتصفح يمنع ترجمة الصفحة داخل متجر الإضافات. حدد النص، ثم اختر «بيان: ترجمة النص المحدد» من القائمة اليمنى.');
      if(!tab?.id||!/^https?:/.test(tab.url||''))throw Error('افتح صفحة ويب عادية أولًا؛ صفحات المتصفح وملفات PDF الداخلية غير مدعومة.');
      const {siteRules={},prefs={}}=await chrome.storage.local.get(['siteRules','prefs']),origin=new URL(tab.url).origin,host=new URL(tab.url).hostname;
      const settings={engine:['google','bing','yandex','deepl'].includes(message.engine)?message.engine:'google',target:message.target==='en'?'en':'ar',source:message.source||prefs.pageSource||'auto',dynamic:message.dynamic!==false,lazy:message.lazy!==false,dontSortResults:!!prefs.dontSortResults};
      const pageFlags=()=>{const language=twpTabs.get(tab.id)?.language||'und';const base=String(language).toLowerCase().split('-')[0];const always=(prefs.alwaysLanguages||[]).map(l=>String(l).toLowerCase());return{siteEnabled:!(prefs.neverSites||[]).includes(host)&&(!!siteRules[origin]||(prefs.alwaysSites||[]).includes(host)),neverEnabled:(prefs.neverSites||[]).includes(host),language,languageEnabled:language!=='und'&&always.some(l=>l===language.toLowerCase()||l===base||l.startsWith(base+'-'))};};
      async function runPageAction(action){if(action!=='status')rememberTwpState(tab.id,{...twpTabs.get(tab.id),manualUntil:Date.now()+3000});const state=await chrome.tabs.sendMessage(tab.id,{type:'page-action',action,settings},{frameId:0});if(action!=='status'){rememberTwpState(tab.id,{...twpTabs.get(tab.id),state:action==='start'?'translated':action==='stop'?'paused':'original',settings});chrome.tabs.sendMessage(tab.id,{type:'twp-subframe-action',action:action==='start'&&prefs.translateFrames===false?'restore':action,settings}).catch(()=>{});}return state;}
      if(message.action==='site-rule'){if(message.enabled){siteRules[origin]=settings;prefs.neverSites=(prefs.neverSites||[]).filter(s=>s!==host);}else{delete siteRules[origin];prefs.alwaysSites=(prefs.alwaysSites||[]).filter(s=>s!==host);}await chrome.storage.local.set({siteRules,prefs});let state={};if(message.enabled)state=await runPageAction('start');else state=await runPageAction('status').catch(()=>({}));respond({ok:true,...state,...pageFlags()});return;}
      if(message.action==='language-rule'){const language=(twpTabs.get(tab.id)?.language||message.language||'und');const code=String(language).toLowerCase();if(message.enabled&&(code==='und'||!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(code)))throw Error('لم تُكتشف لغة الصفحة بعد. انتظر لحظة ثم أعد المحاولة.');prefs.alwaysLanguages=[...(prefs.alwaysLanguages||[])];prefs.neverLanguages=[...(prefs.neverLanguages||[])];const base=code.split('-')[0];const match=l=>{l=String(l).toLowerCase();return l===code||l===base||l.startsWith(base+'-');};if(message.enabled){if(!prefs.alwaysLanguages.some(match))prefs.alwaysLanguages.push(base);prefs.neverLanguages=prefs.neverLanguages.filter(l=>!match(l));prefs.neverSites=(prefs.neverSites||[]).filter(s=>s!==host);}else prefs.alwaysLanguages=prefs.alwaysLanguages.filter(l=>!match(l));await chrome.storage.local.set({prefs,siteRules});let state={};if(message.enabled)state=await runPageAction('start');else state=await runPageAction('status').catch(()=>({}));respond({ok:true,...state,...pageFlags()});return;}
      if(message.action==='site-policy'){prefs.neverSites=(prefs.neverSites||[]).filter(s=>s!==host);prefs.alwaysSites=(prefs.alwaysSites||[]).filter(s=>s!==host);delete siteRules[origin];if(message.policy==='never')prefs.neverSites.push(host);await chrome.storage.local.set({prefs,siteRules});if(message.policy==='never'){await chrome.tabs.sendMessage(tab.id,{type:'page-action',action:'restore'},{frameId:0});chrome.tabs.sendMessage(tab.id,{type:'twp-subframe-action',action:'restore'}).catch(()=>{});}respond({ok:true,...pageFlags(),siteEnabled:false,neverEnabled:message.policy==='never'});return;}
      if(!['start','stop','restore','status'].includes(message.action))throw Error('أمر غير معروف.');
      const state=await runPageAction(message.action);respond({ok:true,...state,...pageFlags()});
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
