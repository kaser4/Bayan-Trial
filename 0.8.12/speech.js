'use strict';
const systemVoices=()=>new Promise(resolve=>chrome.tts.getVoices(resolve));
const speechLanguage=value=>String(value||'').toLowerCase().split(/[-_]/)[0];
let speechGeneration=0,speechController;
function cancelSpeech(){speechGeneration++;speechController?.abort();speechController=null;chrome.tts.stop();}
function speechEscape(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
async function readSpeech(message){
 cancelSpeech();const generation=speechGeneration;
 const text=String(message.text||'').trim();if(!text)throw Error('لا يوجد نص للقراءة.');
 const language=speechLanguage(message.lang||'ar'),rate=Math.max(.5,Math.min(2,Number(message.rate)||1));
 const {prefs={},speech={}}=await chrome.storage.local.get(['prefs','speech']);
 if(generation!==speechGeneration)return {ok:false,cancelled:true};
 const mode=message.mode||prefs.speechMode||'google';
 if(mode==='google'||mode==='bing'){
  if(text.length>(mode==='google'?200:1000))throw Error('جزء الصوت أطول من الحد المسموح.');
  speechController=new AbortController();
  const signal=AbortSignal.any([speechController.signal,AbortSignal.timeout(25000)]);let audio;
  try{audio=await webSpeechChunk({...message,text,mode},signal);}catch(error){if(mode!=='bing'||signal.aborted)throw error;audio=await webSpeechChunk({...message,text,mode:'google'},signal);audio.fallback=true;}
  if(generation!==speechGeneration)return {ok:false,cancelled:true};return audio;
 }
 const voices=await systemVoices(),matching=voices.filter(v=>speechLanguage(v.lang)===language);
 if(generation!==speechGeneration)return {ok:false,cancelled:true};
 if(!matching.length)throw Error(language==='ar'?'لا يوجد صوت عربي متاح في المتصفح. اختر صوت Google أو Bing من إعدادات الصوت.':'لا يوجد صوت مناسب لهذه اللغة في الجهاز.');
 const score=v=>(/neural|natural|online|enhanced/i.test(v.voiceName)?10:0)+(v.remote?1:0);
 const voice=matching.find(v=>v.voiceName===message.voice)||matching.sort((a,b)=>score(b)-score(a))[0];
 return new Promise(resolve=>chrome.tts.speak(text.slice(0,12000),{lang:voice.lang,voiceName:voice.voiceName,rate},()=>resolve(chrome.runtime.lastError?{ok:false,error:'تعذر تشغيل صوت الجهاز. اختر صوتًا آخر أو فعّل الصوت السحابي.'}:{ok:true,voice:voice.voiceName})));
}
