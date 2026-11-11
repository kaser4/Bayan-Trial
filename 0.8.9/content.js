(() => {
  if(window.top!==window)return;
  if (document.getElementById('bayan-extension-root')) return;
  const host = document.createElement('div'); host.id = 'bayan-extension-root';host.className='notranslate';host.setAttribute('translate','no');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
  document.documentElement.append(host);
  const shadow = host.attachShadow({mode:'closed'});
  const style = document.createElement('style');
  style.textContent = `*{box-sizing:border-box}button{font-family:Tahoma,Arial,sans-serif;cursor:pointer}.bubble{position:absolute;pointer-events:auto;border:1px solid #ffffff60;display:grid;place-items:center;touch-action:none;user-select:none;box-shadow:0 4px 18px #0003;padding:0;font-weight:bold}.bubble:hover{opacity:.75!important}.panel{position:fixed;pointer-events:auto;display:flex;flex-direction:column;background:#fff;box-shadow:0 14px 60px #0005;border:1px solid #cbd5e1;border-radius:16px;overflow:hidden;resize:both;min-width:300px;min-height:280px;max-width:100vw;max-height:100vh}.bar{height:36px;flex-shrink:0;background:#eff6ff;display:flex;align-items:center;justify-content:space-between;padding:0 10px;color:#0f172a;cursor:move;touch-action:none;font:12px Tahoma}.bar button{border:0;background:transparent;color:#0f172a;font-size:18px;padding:0 8px}.panel iframe{border:0;flex:1;width:100%;min-height:0;background:white}.hidden{display:none!important}.shade{position:absolute;inset:36px 0 0;display:none}`;
  shadow.append(style);
  style.textContent += '.bar{display:none}.panel{min-width:350px;min-height:320px}.shade{inset:0}';
  style.textContent += '.resizeGrip{position:absolute;pointer-events:auto;z-index:3;touch-action:none}.resizeGrip.bottom{height:9px;bottom:0;left:20px;right:20px;cursor:ns-resize}.resizeGrip.side{width:9px;right:0;top:20px;bottom:20px;cursor:ew-resize}.resizeGrip.corner{right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;background:repeating-linear-gradient(135deg,transparent 0 4px,#94a3b8 4px 5px,transparent 5px 8px);clip-path:polygon(100% 0,100% 100%,0 100%)}';
  const bubble = document.createElement('button'); bubble.className='bubble hidden'; bubble.title='بيان: ترجمة التحديد · اسحب لتغيير المكان · زر يمين للإعدادات'; bubble.setAttribute('aria-label','بيان: ترجمة النص المحدد');
  const panel=document.createElement('section'); panel.className='panel hidden';
  const bar=document.createElement('div'); bar.className='bar';
  const label=document.createElement('span'); label.textContent='بيان · اسحب الشريط لتحريك النافذة';
  const close=document.createElement('button'); close.textContent='×'; close.title='إغلاق';
  bar.append(label,close);
  const frame=document.createElement('iframe'); frame.src=chrome.runtime.getURL('app.html?embedded=1'); frame.title='بيان — الترجمة';
  const shade=document.createElement('div'); shade.className='shade';
  panel.append(bar,frame,shade); shadow.append(bubble,panel);
  globalThis.bayanPageStateChanged=state=>{if(loaded&&bridgeToken)frame.contentWindow.postMessage({bayan:true,action:'page-state',state,token:bridgeToken,requestId:crypto.randomUUID()},new URL(frame.src).origin);};
  let resizeDrag=null;
  for(const kind of ['bottom','side','corner']){
    const handle=document.createElement('div');handle.className=`resizeGrip ${kind}`;handle.title=kind==='bottom'?'اسحب لتغيير الطول':kind==='side'?'اسحب لتغيير العرض':'اسحب لتغيير الحجم';panel.append(handle);
    handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const r=panel.getBoundingClientRect();resizing=true;resizeDrag={kind,x:e.clientX,y:e.clientY,w:r.width,h:r.height};handle.setPointerCapture(e.pointerId);shade.style.display='block';});
    handle.addEventListener('pointermove',e=>{if(!resizeDrag)return;const d=resizeDrag;if(d.kind!=='bottom')panel.style.width=`${clamp(d.w+e.clientX-d.x,Math.min(350,innerWidth),Math.max(350,innerWidth-(panelLeft||0)))}px`;if(d.kind!=='side')panel.style.height=`${clamp(d.h+e.clientY-d.y,Math.min(300,innerHeight),Math.max(300,innerHeight-(panelTop||0)))}px`;});
    function finishResize(){if(!resizeDrag)return;resizeDrag=null;rememberSize();resizing=false;shade.style.display='none';paint();}
    handle.addEventListener('pointerup',finishResize);handle.addEventListener('pointercancel',finishResize);
  }
  let prefs={}, selected='', hasSelection=false, loaded=false, moved=false, drag=null, sizeTimer, bridgeToken='', pendingAction='selection',requestId=crypto.randomUUID(), suppressedText=null, panelLeft=null,panelTop=null,headerDrag=null,resizing=false,pointer=null,parkedAt=null,pointerDown=false,placeOnRelease=false;
  const defaults={buttonX:.97,buttonY:.62,buttonSize:48,buttonColor:'#2563eb',iconColor:'#ffffff',opacity:.85,shape:'circle',icon:'ع',locked:false,followMouse:true,buttonCustom:false,mouseGapCm:2,onlySelection:true,dismissOnOutside:true,enabled:true,panelX:.95,panelY:.9,panelW:620,panelH:430};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const position=(el,x,y,w,h)=>{el.style.left=`${Math.round(clamp(x,0,1)*Math.max(0,innerWidth-w))}px`;el.style.top=`${Math.round(clamp(y,0,1)*Math.max(0,innerHeight-h))}px`;};
  const cmToPx=cm=>Math.max(.3,Math.min(10,Number(cm)||2))*96/2.54;
  function followsPointer(){return prefs.followMouse!==false&&!prefs.locked;}
  function parkButton(){
    if(!parkedAt)return;
    const size=40,hostBox=host.getBoundingClientRect(),gap=cmToPx(prefs.mouseGapCm);
    const offsetX=Math.round(Math.min(16,Math.max(6,gap*.08))),offsetY=Math.round(Math.min(12,Math.max(4,gap*.05)));
    let left=parkedAt.x-hostBox.left+offsetX,top=parkedAt.y-hostBox.top+offsetY;
    left=clamp(left,0,Math.max(0,hostBox.width-size));
    top=clamp(top,0,Math.max(0,hostBox.height-size));
    bubble.style.left=`${Math.round(left)}px`;
    bubble.style.top=`${Math.round(top)}px`;
  }
  function paint(){
    prefs={...defaults,...prefs};
    const size=40,width=40;
    Object.assign(bubble.style,{width:'40px',height:'40px',background:'#000000',color:'#ffffff',opacity:'.75',borderRadius:'50%',fontSize:'17px'});
    bubble.textContent='ع';
    const custom=followsPointer()&&!!prefs.buttonCustom;
    bubble.title=custom?'بيان: ترجمة التحديد · المكان المحفوظ بعد السحب':followsPointer()?'بيان: ترجمة التحديد · يظهر تحت التحديد، واسحبه ليحفظ مكانه':'بيان: ترجمة التحديد · اسحب لتغيير المكان · زر يمين للإعدادات';
    if(!(drag&&drag.kind==='bubble')){if(followsPointer()&&!custom)parkButton();else position(bubble,prefs.buttonX,prefs.buttonY,width,size);}
    bubble.classList.toggle('hidden',!prefs.enabled || ((prefs.onlySelection || prefs.dismissOnOutside) && !hasSelection) || (followsPointer() && !custom && !parkedAt));
    if(!resizing){panel.style.width=`${Math.min(prefs.panelW,innerWidth)}px`; panel.style.height=`${Math.min(prefs.panelH,innerHeight)}px`;}
    if(panelLeft!==null){panelLeft=clamp(panelLeft,0,Math.max(0,innerWidth-panel.offsetWidth));panelTop=clamp(panelTop,0,Math.max(0,innerHeight-panel.offsetHeight));panel.style.left=`${panelLeft}px`;panel.style.top=`${panelTop}px`;}
  }
  function anchor(){
    const b=bubble.getBoundingClientRect(),w=panel.offsetWidth,h=panel.offsetHeight,gap=8;
    if(Number.isFinite(prefs.windowOffsetX)&&Number.isFinite(prefs.windowOffsetY)){panelLeft=b.left+prefs.windowOffsetX;panelTop=b.top+prefs.windowOffsetY;}
    else if(b.bottom+gap+h<=innerHeight){panelLeft=b.left;panelTop=b.bottom+gap;}
    else if(b.right+gap+w<=innerWidth){panelLeft=b.right+gap;panelTop=b.top;}
    else if(b.left-gap-w>=0){panelLeft=b.left-gap-w;panelTop=b.top;}
    else if(b.top-gap-h>=0){panelLeft=b.left;panelTop=b.top-gap-h;}
    else{panelLeft=b.left;panelTop=b.bottom+gap;}
    paint();
  }
  // The page script cannot read settings or API keys. Layout is bridged by trusted background handlers.
  async function savePatch(patch){await chrome.runtime.sendMessage({type:'layout-set',patch});}
  function rememberSize(){if(panel.classList.contains('hidden'))return;const r=panel.getBoundingClientRect();if(r.width>0&&r.height>0){prefs.panelW=Math.round(r.width);prefs.panelH=Math.round(r.height);clearTimeout(sizeTimer);savePatch({panelW:prefs.panelW,panelH:prefs.panelH});}}
  function dismiss(){chrome.runtime.sendMessage({type:'stop-page-speech'}).catch(()=>{});if(loaded&&bridgeToken)frame.contentWindow.postMessage({bayan:true,action:'stop-audio',token:bridgeToken,requestId:crypto.randomUUID()},new URL(frame.src).origin);if(resizing){rememberSize();resizing=false;}hasSelection=false;suppressedText=window.getSelection()?.toString().trim()||'';panel.classList.add('hidden');paint();}
  function settleUnderPointer(){
    if(!followsPointer()||prefs.buttonCustom||!pointer||!hasSelection||pointerDown||!placeOnRelease)return;
    parkedAt={x:pointer.x,y:pointer.y};
    placeOnRelease=false;
  }
  function capture(event){
    if(Number.isFinite(event?.clientX))pointer={x:event.clientX,y:event.clientY};
    if(event?.type==='pointerup')pointerDown=false;
    if(event?.composedPath?.().includes(host) || (document.activeElement===host && !window.getSelection()?.toString().trim()))return;
    const previouslySelected=hasSelection;
    const el=document.activeElement;
    if(el?.tagName==='INPUT' && el.type==='password'){hasSelection=false;paint();return;}
    let value=window.getSelection()?.toString()||'';
    if ((el?.tagName==='TEXTAREA' || el?.tagName==='INPUT') && typeof el.selectionStart==='number') value=el.value.slice(el.selectionStart,el.selectionEnd);
    value=value.trim();
    if(value!==suppressedText)suppressedText=null;
    hasSelection=!!value && value!==suppressedText;
    if(hasSelection)selected=value.trim().slice(0,12001);
    if(event?.type==='pointerup' && !event.composedPath?.().includes(host))placeOnRelease=true;
    settleUnderPointer();
    if(!hasSelection){parkedAt=null;if(event?.type!=='pointerup')placeOnRelease=false;}
    if(prefs.dismissOnOutside && previouslySelected && !hasSelection)dismiss();
    paint();
  }
  document.addEventListener('selectionchange',capture);
  document.addEventListener('select',capture,true);
  document.addEventListener('pointerup',capture);
  document.addEventListener('pointerdown',e=>{
    if(e.composedPath().includes(host))return;
    pointerDown=true;
    placeOnRelease=true;
    pointer={x:e.clientX,y:e.clientY};
    if(followsPointer()&&!prefs.buttonCustom)parkedAt=null;
    if(!panel.classList.contains('hidden') || prefs.dismissOnOutside)dismiss();
    else paint();
  },true);
  function send(action=pendingAction){pendingAction=action; if(loaded && bridgeToken) frame.contentWindow.postMessage({bayan:true,action,text:selected,token:bridgeToken,requestId},new URL(frame.src).origin); }
  function open(text){requestId=crypto.randomUUID();if(typeof text==='string')selected=text;else capture();panel.classList.remove('hidden');paint();anchor();send('selection');}
  frame.addEventListener('load',()=>{loaded=true;if(!panel.classList.contains('hidden'))send();});
  addEventListener('message',e=>{if(e.source===frame.contentWindow && e.origin===new URL(frame.src).origin && e.data?.bayanReady && !panel.classList.contains('hidden'))send();});
  addEventListener('message',e=>{
    if(e.source!==frame.contentWindow || e.origin!==new URL(frame.src).origin || !bridgeToken || e.data?.token!==bridgeToken)return;
    const m=e.data;
    if(m.bayanControl==='close')dismiss();
    if(m.bayanControl==='drag-start')headerDrag={x:m.x,y:m.y,left:panelLeft,top:panelTop};
    if(m.bayanControl==='drag-move'&&headerDrag&&Number.isFinite(m.x)&&Number.isFinite(m.y)){panelLeft=headerDrag.left+m.x-headerDrag.x;panelTop=headerDrag.top+m.y-headerDrag.y;paint();}
    if(m.bayanControl==='drag-end'){headerDrag=null;const b=bubble.getBoundingClientRect();prefs.windowOffsetX=panelLeft-b.left;prefs.windowOffsetY=panelTop-b.top;savePatch({windowOffsetX:prefs.windowOffsetX,windowOffsetY:prefs.windowOffsetY});}
  });
  close.addEventListener('click',dismiss);
  bubble.addEventListener('click',()=>{if(!moved)open();});
  function start(e,kind){
    if(kind==='bubble'&&e.button===0)e.preventDefault();
    if(e.button!==0 || (kind==='bubble' && prefs.locked) || (kind==='panel' && e.target===close))return;
    const el=kind==='bubble'?bubble:panel, r=el.getBoundingClientRect();
    drag={kind,el,x:e.clientX,y:e.clientY,left:r.left,top:r.top,w:r.width,h:r.height};moved=false;
    el.setPointerCapture(e.pointerId); if(kind==='panel')shade.style.display='block';
  }
  function move(e){if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)moved=true;if(!moved)return;
    drag.el.style.left=`${clamp(drag.left+dx,0,Math.max(0,innerWidth-drag.w))}px`;drag.el.style.top=`${clamp(drag.top+dy,0,Math.max(0,innerHeight-drag.h))}px`;
    if(drag.kind==='bubble')prefs.buttonCustom=true;
  }
  async function end(){if(!drag)return;const d=drag;drag=null;shade.style.display='none';if(moved){const r=d.el.getBoundingClientRect();const patch=d.kind==='bubble'?{buttonX:r.left/Math.max(1,innerWidth-r.width),buttonY:r.top/Math.max(1,innerHeight-r.height),buttonCustom:true}:{panelX:r.left/Math.max(1,innerWidth-r.width),panelY:r.top/Math.max(1,innerHeight-r.height)};Object.assign(prefs,patch);await savePatch(patch);}setTimeout(()=>moved=false,0);}
  bubble.addEventListener('pointerdown',e=>start(e,'bubble'));bar.addEventListener('pointerdown',e=>start(e,'panel'));
  panel.addEventListener('pointerdown',e=>{const r=panel.getBoundingClientRect();if(e.target===panel&&e.clientX>=r.right-22&&e.clientY>=r.bottom-22){resizing=true;}});
  addEventListener('pointerup',()=>{if(resizing){rememberSize();resizing=false;paint();}},true);
  for(const el of [bubble,bar,panel]){el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);}
  let initialResize=true;
  new ResizeObserver(()=>{if(initialResize || panel.classList.contains('hidden'))return;if(resizing){const r=panel.getBoundingClientRect();prefs.panelW=Math.round(r.width);prefs.panelH=Math.round(r.height);}clearTimeout(sizeTimer);sizeTimer=setTimeout(rememberSize,180);}).observe(panel);
  addEventListener('pointermove',e=>{pointer={x:e.clientX,y:e.clientY};},{passive:true,capture:true});
  addEventListener('scroll',()=>{if(followsPointer()&&!prefs.buttonCustom)parkButton();},{passive:true,capture:true});
  addEventListener('resize',paint);
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{if(msg.type==='page-action'){const api=globalThis.BayanPage;reply(api?.[msg.action]?api[msg.action](msg.settings):{error:'حدّث الصفحة لتحميل مترجم الموقع.'});}if(msg.type==='open'){open(msg.text);reply({ok:true});}if(msg.type==='selection'){capture();reply({text:selected});}if(msg.type==='prefs-updated'){prefs={...defaults,...msg.prefs};paint();}});
  chrome.runtime.sendMessage({type:'layout-get'}).then(data=>{bridgeToken=data.bridgeToken;prefs={...defaults,...data};delete prefs.bridgeToken;delete prefs.siteRule;paint();if(data.siteRule)globalThis.BayanPage?.start(data.siteRule);if(!panel.classList.contains('hidden'))send();setTimeout(()=>initialResize=false,600);});
})();
