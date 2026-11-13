'use strict';
const $=id=>document.getElementById(id);
const query=new URLSearchParams(location.search), embedded=query.has('embedded');
const toolbar=!embedded;document.body.className=embedded?'embedded':'toolbar';
const defaults={buttonX:.97,buttonY:.62,buttonSize:48,controlsSize:100,translateDynamic:true,lazyPage:true,pageEngine:'google',pageTarget:'ar',pageSource:'auto',translateFrames:true,translatePre:false,showOriginalHover:false,dontSortResults:false,followTranslationLinks:false,alwaysSites:[],neverSites:[],alwaysLanguages:[],neverLanguages:[],customDictionary:[],readingSize:18,buttonColor:'#2563eb',iconColor:'#ffffff',opacity:.85,shape:'circle',icon:'ع',locked:false,followMouse:true,buttonCustom:false,mouseGapCm:2,onlySelection:true,dismissOnOutside:true,enabled:true,panelX:.95,panelY:.9,panelW:620,panelH:430,theme:'light',fontSize:18,originalFontSize:18,translationFontSize:18,font:'Tahoma, Arial, sans-serif',textColor:'#0f172a',originalColor:'#000000',translationColor:'#1d4ed8',background:'#f8fafc',engine:'google',service_google:true,service_bing:true,service_yandex:true,service_deepl:true,webFallback:true,webCache:true,source:'auto',target:'ar',rate:1,arabicVoice:'',originalVoice:'',audioFallback:true,speechMode:'google',azureArabicVoice:'ar-SA-ZariyahNeural',azureEnglishVoice:'en-US-JennyNeural'};
const themes={light:{background:'#f8fafc',textColor:'#0f172a',card:'#ffffff',muted:'#64748b',accent:'#2563eb',line:'#dce4ef'},dark:{background:'#111827',textColor:'#f3f4f6',card:'#1f2937',muted:'#bdc7d6',accent:'#8b5cf6',line:'#475569'},sage:{background:'#fffbeb',textColor:'#292524',card:'#fffef9',muted:'#726b60',accent:'#047857',line:'#dedbcb'}};
let prefs={...defaults},result='',detected='',sequence=0,token='',lastRequest='',autoTimer,audioTimer,audioPlayer,audioUrl,audioSeq=0,saveChain=Promise.resolve();
function status(text,error=false){$('status').textContent=text;if(error){$('result').textContent=text;$('result').classList.add('error');}else $('result').classList.remove('error');}
function settings(show=true){
 if(embedded){$('readingSettings').hidden=!show;$('appearanceMenu').hidden=true;return;}
 $('settings').hidden=!show;$('toolbarHome').hidden=show;$('back').hidden=!show;$('settingsToggle').hidden=show;$('appearanceMenu').hidden=true;
}
function paint(){
 const t=themes[prefs.theme]||themes.light,r=document.documentElement.style,size=prefs.readingSize||prefs.originalFontSize||18;
 prefs.originalFontSize=prefs.translationFontSize=size;
 for(const [name,value]of Object.entries({bg:t.background,text:t.textColor,card:t.card,muted:t.muted,accent:t.accent,line:t.line,original:prefs.theme==='dark'?'#f3f4f6':'#000000',translation:prefs.theme==='dark'?'#c4b5fd':'#1d4ed8',font:prefs.font,size:prefs.fontSize+'px','original-size':size+'px','translation-size':size+'px','control-scale':'1.3'}))r.setProperty('--'+name,value);
 document.documentElement.style.colorScheme=prefs.theme==='dark'?'dark':'light';
 for(const key of Object.keys(defaults)){const el=$(key);if(!el||['alwaysSites','neverSites','alwaysLanguages','neverLanguages','customDictionary'].includes(key))continue;if(el.type==='checkbox')el.checked=!!prefs[key];else el.value=String(prefs[key]);}
 $('readingSize').value=$('readingSizeMain').value=size;
 document.querySelectorAll('[data-engine]').forEach(b=>{b.classList.toggle('active',b.dataset.engine===prefs.engine);b.hidden=prefs['service_'+b.dataset.engine]===false;});balance();
}
function save(patch){
 Object.assign(prefs,patch);paint();
 saveChain=saveChain.catch(()=>{}).then(async()=>{const {prefs:stored={}}=await chrome.storage.local.get('prefs');await chrome.storage.local.set({prefs:{...stored,...patch}});});
 return saveChain;
}
function decode(value){const t=document.createElement('textarea');t.innerHTML=value;return t.value;}
async function run(){
 clearTimeout(autoTimer);
 const text=$('original').value.trim();if(!text){status('حدد نصًا أو اكتبه أولًا.',true);return;}
 const seq=++sequence;result='';$('result').textContent='جارٍ الترجمة…';status('جارٍ الاتصال بالمحرك…');
 try{
  const response=await chrome.runtime.sendMessage({type:'translate',text,engine:prefs.engine,source:prefs.source,target:prefs.target});
  if(seq!==sequence)return;
  if(!response?.ok)throw Error(response?.error||'لم تصل استجابة من المحرك.');
  $('translator').querySelector('.result>label').textContent='الترجمة · '+({google:'Google',bing:'Bing',yandex:'Yandex',deepl:'DeepL'}[response.engine]||prefs.engine)+(response.fallback?' (بديل)':'');result=decode(response.text);detected=response.source||'';$('result').textContent=result;paintDetectedSource();status(`اكتملت الترجمة${detected?' · لغة المصدر: '+detected:''}`);
 }catch(e){if(seq===sequence){$('result').textContent='لم تكتمل الترجمة';status(e.message,true);}}
}
function setText(text,auto=true){clearTimeout(autoTimer);if(!text?.trim())return;sequence++;$('original').value=text;result='';$('result').textContent='ستظهر الترجمة هنا';count();settings(false);if(auto)run();}
function balance(){
 const area=$('translator');if(area.hidden)return;
 const width=Math.max(100,$('original').clientWidth),font=prefs.fontSize;
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=font+'px '+prefs.font;
 function height(text,size){ctx.font=size+'px '+prefs.font;return String(text||' ').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(ctx.measureText(s).width/width)),0)*size*1.6+53;}
 const a=height($('original').value,prefs.originalFontSize),b=height(result||$('result').textContent,prefs.translationFontSize),ratio=Math.max(.25,Math.min(.75,a/(a+b)));area.style.setProperty('--source-share',`${ratio}fr`);area.style.setProperty('--target-share',`${1-ratio}fr`);
}
new ResizeObserver(balance).observe($('translator'));
new ResizeObserver(()=>{const h=document.querySelector('header').offsetHeight;$('appearanceMenu').style.top=`${h-5}px`;$('pageMenu').style.top=`${h+4}px`;$('pageMenu').style.maxHeight=`calc(100% - ${h+15}px)`;}).observe(document.querySelector('header'));
const resultObserver=new MutationObserver(balance);resultObserver.observe($('result'),{childList:true,subtree:true,characterData:true});
function count(){balance();$('count').textContent=`${$('original').value.length} حرف`;}
function audioNote(text){$('audioNotice').textContent=text;$('audioNotice').hidden=false;clearTimeout(audioTimer);audioTimer=setTimeout(()=>$('audioNotice').hidden=true,10000);}
function stopAudio(){audioSeq++;if(audioPlayer){audioPlayer.pause();audioPlayer=null;}if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl='';}chrome.runtime.sendMessage({type:'stop'});}
function speechParts(text,limit){const parts=[];let rest=text;while(rest.length>limit){let cut=rest.lastIndexOf(' ',limit);if(cut<limit/3)cut=limit;else cut++;if(/[\uD800-\uDBFF]/.test(rest[cut-1]))cut--;parts.push(rest.slice(0,cut));rest=rest.slice(cut);}if(rest)parts.push(rest);return parts;}
async function speak(text,lang,voice){
 if(!text?.trim()){audioNote('لا يوجد نص للقراءة.');return;}stopAudio();const seq=audioSeq;audioNote('جارٍ تجهيز الصوت…');
 const mode=prefs.engine==='bing'?'bing':'google',parts=speechParts(text,160);
 try{for(const part of parts){
  if(seq!==audioSeq)return;const response=await chrome.runtime.sendMessage({type:'speak',text:part,lang,voice,rate:prefs.rate,mode});if(seq!==audioSeq)return;if(!response?.ok)throw Error(response?.error||'تعذر تشغيل الصوت.');
  if(response.audio){const bytes=Uint8Array.from(atob(response.audio),c=>c.charCodeAt(0));audioUrl=URL.createObjectURL(new Blob([bytes],{type:response.mime}));const player=new Audio(audioUrl);audioPlayer=player;player.playbackRate=prefs.rate;
   const ended=new Promise((resolve,reject)=>{player.onended=resolve;player.onerror=()=>reject(Error('تعذر تشغيل الملف الصوتي.'));player.onpause=()=>{if(seq!==audioSeq)resolve();};});
   await player.play();if(seq!==audioSeq){player.pause();return;}if(response.fallback)audioNote('تعذر صوت Bing؛ تُستخدم قراءة Google.');else $('audioNotice').hidden=true;await ended;if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl='';}audioPlayer=null;
  }else{$('audioNotice').hidden=true;}
 }}catch(error){if(seq===audioSeq)audioNote(error.message);}
}
addEventListener('pagehide',stopAudio);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAudio();});
async function copy(text){try{await navigator.clipboard.writeText(text);status('تم النسخ.');}catch{status('تعذر النسخ التلقائي؛ حدد النص وانسخه يدويًا.',true);}}
function originalLang(){return prefs.source==='auto'?(detected||(/[\u0600-\u06ff]/.test($('original').value)?'ar':'en')):prefs.source;}
document.querySelectorAll('[data-engine]').forEach(b=>b.onclick=()=>{$('engine').value=b.dataset.engine;$('engine').dispatchEvent(new Event('change'));});
let headerDrag=false;const handle=document.querySelector('header');handle.style.cursor='move';handle.onpointerdown=e=>{if(!embedded||e.button!==0||e.target.closest('button,input,select,a'))return;e.preventDefault();headerDrag=true;handle.setPointerCapture(e.pointerId);parent.postMessage({bayanControl:'drag-start',token,x:e.screenX,y:e.screenY},'*');};handle.onpointermove=e=>{if(headerDrag)parent.postMessage({bayanControl:'drag-move',token,x:e.screenX,y:e.screenY},'*');};handle.onpointerup=handle.onpointercancel=()=>{if(headerDrag){headerDrag=false;parent.postMessage({bayanControl:'drag-end',token},'*');}};
$('original').addEventListener('input',()=>{sequence++;detected='';paintDetectedSource();result='';status('');$('result').textContent='ستظهر الترجمة هنا';count();clearTimeout(autoTimer);if($('original').value.trim())autoTimer=setTimeout(run,450);});
$('original').addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter')run();});
$('settingsToggle').onclick=()=>settings(embedded?$('readingSettings').hidden:$('settings').hidden);$('back').onclick=()=>settings(false);
$('speakOriginal').onclick=()=>{const lang=originalLang();speak($('original').value,lang,lang.startsWith('ar')?prefs.arabicVoice:prefs.originalVoice);};
$('speakResult').onclick=()=>speak(result,prefs.target,prefs.target==='ar'?prefs.arabicVoice:prefs.originalVoice);
$('stop').onclick=()=>{stopAudio();$('audioNotice').hidden=true;};
$('copyOriginal').onclick=()=>copy($('original').value);$('copyResult').onclick=()=>{if(result)copy(result);};
$('smaller').onclick=()=>save({readingSize:Math.max(12,(prefs.readingSize||18)-1)});$('larger').onclick=()=>save({readingSize:Math.min(48,(prefs.readingSize||18)+1)});
function theme(name){save({theme:name,background:themes[name].background,textColor:themes[name].textColor});}
$('themeToggle').onclick=()=>{$('appearanceMenu').hidden=!$('appearanceMenu').hidden;$('readingSettings').hidden=true;};document.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{theme(b.dataset.theme);$('appearanceMenu').hidden=true;});$('theme').onchange=e=>theme(e.target.value);
document.addEventListener('pointerdown',e=>{if(!$('appearanceMenu').hidden&&!$('appearanceMenu').contains(e.target)&&!$('themeToggle').contains(e.target))$('appearanceMenu').hidden=true;});
for(const id of ['readingSize','readingSizeMain'])$(id).oninput=e=>save({readingSize:Number(e.target.value)});
for(const key of ['translateDynamic','lazyPage','pageEngine','pageTarget','pageSource','translateFrames','translatePre','showOriginalHover','dontSortResults','followTranslationLinks','locked','followMouse','mouseGapCm','dismissOnOutside','font','fontSize','rate','service_google','service_bing','service_yandex','service_deepl','webFallback','webCache'])$(key).addEventListener('input',e=>{const el=e.target;const value=el.type==='checkbox'?el.checked:el.type==='range'||el.type==='number'?Number(el.value):el.value;save({[key]:key==='mouseGapCm'?Math.max(.3,Math.min(10,value||2)):value});});
for(const key of ['engine','source','target'])$(key).onchange=async e=>{sequence++;result='';$('result').textContent='ستظهر الترجمة هنا';await save({[key]:e.target.value});paintDetectedSource();if($('original').value.trim())run();};
$('resetPosition').onclick=()=>save({buttonX:.97,buttonY:.62,panelX:.95,panelY:.9,panelW:620,panelH:430,enabled:true,locked:false,followMouse:true,buttonCustom:false,mouseGapCm:2});
for(const key of ['panelW','panelH'])$(key).onchange=e=>save({[key]:Math.max(key==='panelW'?350:320,Math.min(2000,Number(e.target.value)||430))});
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{for(const el of document.querySelectorAll('.settingsTab'))el.hidden=el.id!==button.dataset.tab;for(const el of document.querySelectorAll('[data-tab]'))el.classList.toggle('selected',el===button);};
addEventListener('message',e=>{if(!embedded||e.source!==parent||!e.data?.bayan||!token||e.data.token!==token||e.data.requestId===lastRequest)return;lastRequest=e.data.requestId;if(e.data.action==='settings')settings(true);else if(e.data.action==='page-state')renderPageState(e.data.state);else if(e.data.action==='stop-audio')stopAudio();else if(e.data.action==='selection')setText(String(e.data.text||''),true);});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.prefs){prefs={...defaults,...changes.prefs.newValue};paint();}});
const pageTabId=Number(query.get('tab'))||undefined;
const languageNames={ar:'العربية',en:'English',fr:'Français',de:'Deutsch',es:'Español',tr:'Türkçe',fa:'فارسی',ur:'اردو',ru:'Русский',zh:'中文','zh-cn':'中文','zh-tw':'中文',ja:'日本語',ko:'한국어',hi:'हिन्दी',it:'Italiano',pt:'Português',nl:'Nederlands',pl:'Polski',sv:'Svenska',id:'Bahasa Indonesia',ms:'Bahasa Melayu',th:'ไทย',vi:'Tiếng Việt',he:'עברית',el:'Ελληνικά',uk:'Українська',ro:'Română',cs:'Čeština',hu:'Magyar',fi:'Suomi',da:'Dansk',no:'Norsk',bn:'বাংলা',ta:'தமிழ்',te:'తెలుగు',mr:'मराठी',gu:'ગુજરાતી',pa:'ਪੰਜਾਬੀ',sw:'Kiswahili',und:'غير معروفة'};
function languageLabel(code){const raw=String(code||'und').toLowerCase(),base=raw.split('-')[0];return languageNames[raw]||languageNames[base]||raw.toUpperCase();}
function paintDetectedSource(){
 const sel=$('source'),box=$('detectedSourceBox'),meta=$('detectedSourceMeta'),word=$('detectedSourceWord');
 const auto=sel?.querySelector('option[value="auto"]');
 if(auto)auto.textContent='اكتشاف تلقائي';
 if(sel){sel.classList.remove('detectedSource');sel.dir='';}
 if(prefs.source==='auto'&&detected&&box&&meta&&word){
  const code=String(detected).toLowerCase().split('-')[0];
  meta.textContent=languageLabel(code)+' · '+code;
  word.textContent='اللغة';
  box.hidden=false;
 }else if(box)box.hidden=true;
}
function isAlwaysLanguage(code){code=String(code||'').toLowerCase().split('-')[0];return (prefs.alwaysLanguages||[]).some(l=>{l=String(l).toLowerCase();return l===code||l.startsWith(code+'-');});}
let lastPageLanguages=[],detectLangTimer=0;
function renderDetectedLanguageOffers(languages){
 const box=$('detectedLanguageOffers'),empty=$('detectedLanguagesEmpty');if(!box)return;
 lastPageLanguages=Array.isArray(languages)?languages:[];
 box.innerHTML='';
 const items=lastPageLanguages.filter(item=>item?.code&&item.code!=='und');
 if(!items.length){if(empty){empty.hidden=false;empty.textContent='لم تُكتشف لغات في هذه الصفحة بعد.';}return;}
 if(empty)empty.hidden=true;
 for(const item of items){
  const code=String(item.code).toLowerCase().split('-')[0];
  const chip=document.createElement('span');chip.className='chip';chip.dir='ltr';
  const pct=item.percentage?` ${item.percentage}%`:(item.hint?' · في النص':'');
  chip.append(document.createTextNode(languageLabel(code)+' · '+code+pct+' '));
  if(isAlwaysLanguage(code)){
   const mark=document.createElement('span');mark.textContent='✓';mark.title='مضافة للترجمة التلقائية';chip.append(mark);
  }else{
   const add=document.createElement('button');add.type='button';add.textContent='إضافة';add.title='إضافة للترجمة التلقائية';
   add.onclick=async()=>{
    const r=await pageCommand('language-rule',{enabled:true,language:code,addOnly:true});
    if(r?.ok){$('pageStatus').textContent='أُضيفت للترجمة التلقائية: '+languageLabel(code)+' ('+code+').';renderDetectedLanguageOffers(lastPageLanguages);}
   };
   chip.append(add);
  }
  box.append(chip);
 }
}
async function refreshDetectedLanguages(force=false){
 if(!toolbar||$('toolbarHome').hidden)return;
 const now=Date.now();if(!force&&now-detectLangTimer<2000)return;detectLangTimer=now;
 const empty=$('detectedLanguagesEmpty');
 try{
  await saveChain;
  const r=await chrome.runtime.sendMessage({type:'page-action',action:'detect-languages',tabId:pageTabId,engine:prefs.pageEngine,target:prefs.pageTarget,source:prefs.pageSource,dynamic:prefs.translateDynamic,lazy:prefs.lazyPage});
  if(r?.ok)renderDetectedLanguageOffers(r.pageLanguages||[]);
  else if(empty){empty.hidden=false;empty.textContent=r?.error||'تعذر فحص لغات الصفحة.';}
 }catch{if(empty){empty.hidden=false;empty.textContent='تعذر فحص لغات الصفحة.';}}
}
function renderPageState(state){if(!state)return;$('translatePage').disabled=!!state.running;$('stopPage').disabled=!(state.translated||state.running||state.remaining>0);$('translatePage').textContent=state.translated?'إعادة الترجمة':'ترجمة الصفحة كاملة';$('pageStatus').textContent=(state.running?'جارٍ ترجمة الصفحة: ':'')+(state.total?state.done+' / '+state.total+' · ':'')+(state.note||'')+(state.failed?' تعذر '+state.failed+' نص.':'');if(typeof state.neverEnabled==='boolean')$('neverTranslateSite').checked=state.neverEnabled;if(typeof state.siteEnabled==='boolean')$('autoTranslateSite').checked=state.siteEnabled;if(typeof state.languageEnabled==='boolean')$('autoTranslateLanguage').checked=state.languageEnabled;if(state.language){const label=languageLabel(state.language);$('detectedPageLanguage').textContent=state.language==='und'?'لغة الصفحة: جارٍ التعرف…':'لغة الصفحة المكتشفة: '+label+' ('+state.language+')';$('autoLanguageName').textContent=state.language==='und'?'':label+' · '+state.language;$('autoTranslateLanguage').disabled=state.language==='und';}if(Array.isArray(state.pageLanguages))renderDetectedLanguageOffers(state.pageLanguages); }
async function pageCommand(action,extra={}){await saveChain;const r=await chrome.runtime.sendMessage({type:'page-action',action,tabId:pageTabId,engine:prefs.pageEngine,target:prefs.pageTarget,source:prefs.pageSource,dynamic:prefs.translateDynamic,lazy:prefs.lazyPage,...extra});if(!r?.ok){$('pageStatus').textContent=r?.error||'تعذر الاتصال بالصفحة.';if(action==='site-rule')$('autoTranslateSite').checked=!extra.enabled;if(action==='language-rule'&&!extra.addOnly)$('autoTranslateLanguage').checked=!extra.enabled;if(action==='site-policy')$('neverTranslateSite').checked=extra.policy==='never';return;}renderPageState(r);if(['site-rule','language-rule','site-policy'].includes(action)){const stored=await chrome.storage.local.get('prefs');prefs={...defaults,...stored.prefs};loadRuleInputs();if(action==='language-rule')renderDetectedLanguageOffers(lastPageLanguages.length?lastPageLanguages:(r.pageLanguages||[]));}return r;}
$('translatePage').onclick=()=>pageCommand('start');$('restorePage').onclick=()=>pageCommand('restore');$('stopPage').onclick=()=>pageCommand('stop');$('autoTranslateSite').onchange=e=>pageCommand('site-rule',{enabled:e.target.checked});$('autoTranslateLanguage').onchange=e=>pageCommand('language-rule',{enabled:e.target.checked});$('neverTranslateSite').onchange=e=>pageCommand('site-policy',{policy:e.target.checked?'never':'manual'});
setInterval(()=>{if(toolbar&&!$('toolbarHome').hidden&&!document.hidden)pageCommand('status');},1200);
$('openProvider').onclick=()=>{const source=prefs.source==='auto'?'auto':prefs.source,target=prefs.target,text=$('original').value;const e=prefs.engine;let url;
 if(e==='google'){url=new URL('https://translate.google.com/');url.search=new URLSearchParams({sl:source,tl:target,text:text.length<=4000?text:'',op:'translate'}).toString();}
 else if(e==='bing'){url=new URL('https://www.bing.com/translator');url.search=new URLSearchParams({from:source==='auto'?'auto-detect':source,to:target,text:text.length<=4000?text:''}).toString();}
 else if(e==='yandex'){url=new URL('https://translate.yandex.com/');url.search=new URLSearchParams({source_lang:source,target_lang:target,text:text.length<=4000?text:''}).toString();}
 else{url=new URL('https://www.deepl.com/translator');if(text.length<=4000)url.hash=source+'/'+target+'/'+encodeURIComponent(text);}
 chrome.tabs.create({url:url.href});};
function loadRuleInputs(){for(const key of ['alwaysSites','neverSites'])$(key).value=(prefs[key]||[]).join('\n');for(const key of ['alwaysLanguages','neverLanguages'])$(key).value=(prefs[key]||[]).join(', ');$('customDictionary').value=(prefs.customDictionary||[]).map(([k,v])=>k+'='+v).join('\n');}
$('savePageRules').onclick=async()=>{const hosts=id=>[...new Set($(id).value.split(/[\n,]+/).map(s=>{s=s.trim();if(!s)return '';try{return new URL(s.includes('://')?s:'https://'+s).hostname;}catch{return '';}}).filter(Boolean))],langs=id=>[...new Set($(id).value.split(/[\s,]+/).map(s=>s.trim().toLowerCase()).filter(s=>/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(s)))];const dictionary=$('customDictionary').value.split('\n').map(line=>{const i=line.indexOf('=');return i<1?null:[line.slice(0,i).trim().toLowerCase(),line.slice(i+1).trim()];}).filter(Boolean);await save({alwaysSites:hosts('alwaysSites'),neverSites:hosts('neverSites'),alwaysLanguages:langs('alwaysLanguages'),neverLanguages:langs('neverLanguages'),customDictionary:dictionary});$('rulesStatus').textContent='حُفظت القواعد. طبّق الترجمة مجددًا لتحديث الصفحة الحالية.';};
async function init(){
 const stored=await chrome.storage.local.get(['prefs']);prefs={...defaults,...stored.prefs};paint();loadRuleInputs();
 paint();
 const pendingId=query.get('pending');let pendingText='';
 if(pendingId){const stored=await chrome.storage.session.get('bayanPendingText');if(stored.bayanPendingText?.id===pendingId)pendingText=stored.bayanPendingText.text||'';}
 if(embedded){token=(await chrome.runtime.sendMessage({type:'bridge-token'})).token;parent.postMessage({bayanReady:true},'*');}
 else if(pendingText){$('toolbarHome').hidden=true;$('pageMenu').hidden=true;$('translator').hidden=false;$('original').value=pendingText;count();run();}
 else{$('toolbarHome').prepend(document.querySelector('.engineRow'));$('toolbarHome').append($('pageMenu'));$('pageMenu').hidden=false;$('toolbarHome').hidden=false;$('translator').hidden=true;pageCommand('status').then(()=>refreshDetectedLanguages(true));}
 if(query.has('settings'))settings(true);
}
init().catch(()=>status('تعذر تحميل الإضافة. أغلق النافذة وافتحها مجددًا.',true));
