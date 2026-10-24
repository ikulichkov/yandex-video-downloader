(() => {
  const states=new Map(),records=new Map();
  const defaults={placement:'top-left',showCurrentPanel:false};
  const placements=new Set(['separate','top-left','top-right','bottom-left','bottom-right']);
  let preferences={...defaults},host,root,panel,timer=null,scrollFrame=null;
  const active=s=>['starting','progress','processing'].includes(s?.status);
  const rectOf=e=>e.getBoundingClientRect?.()||{left:0,top:0,right:160,bottom:90,width:160,height:90};
  const visible=r=>r.width>40&&r.height>25&&r.bottom>=0&&r.top<(typeof innerHeight==='number'?innerHeight:2000)+100;
  let pageURL=location.href;
  function clearControls(){for(const item of records.values())item.ui.remove();records.clear();panel?.remove();panel=null;}
  function routeChanged(){if(pageURL===location.href)return false;pageURL=location.href;clearControls();return true;}
  function exposed(card,box){
    if(card.isConnected===false||card.getClientRects?.().length===0)return false;
    if(typeof getComputedStyle==='function'){const style=getComputedStyle(card);if(style.visibility==='hidden'||style.visibility==='collapse'||style.display==='none')return false;}
    if(!document.elementsFromPoint||!card.contains)return true;
    const x=Math.max(0,box.left)+Math.max(0,Math.min(box.right,innerWidth)-Math.max(0,box.left))/2;
    const y=Math.max(0,box.top)+Math.max(0,Math.min(box.bottom,innerHeight)-Math.max(0,box.top))/2;
    const hit=document.elementsFromPoint(x,y).find(e=>e!==host);
    return !!hit&&card.contains(hit);
  }
  function ensureRoot(){
    if(root&&host.isConnected!==false)return root;
    host=document.createElement('div');host.id='yvd-root';
    host.style && (host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;');
    root=host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=`
      :host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646}
      .control{position:fixed;display:flex;flex-direction:column;align-items:flex-start;gap:4px;max-width:240px;pointer-events:none;font:12px/1.4 Arial,sans-serif;color:#eee}
      button{pointer-events:auto;cursor:pointer;border:1px solid #0003;border-radius:9px;background:#ffdc60;color:#171717;font:600 16px/1 Arial,sans-serif;min-width:28px;min-height:28px;padding:5px 8px;box-shadow:0 1px 5px #0004}
      button:hover{background:#ffe68c}button:focus-visible{outline:3px solid #75a7ff;outline-offset:2px}
      .status{background:#252525;color:#f5f5f5;border-radius:5px;padding:3px 6px;overflow-wrap:anywhere;max-width:235px}.status:empty{display:none}
      .separate button,.panel button{font-size:12px;padding:8px 11px}.separate{max-width:260px}
      .panel{right:20px;bottom:20px;left:auto;top:auto;max-width:320px;padding:13px;border:1px solid #777;border-radius:13px;background:#202124;box-shadow:0 4px 20px #0006;gap:9px}
      .title{font-weight:600}.panel .status{background:none;padding:0}
    `;root.append(style);(document.documentElement||document.body).append(host);return root;
  }
  function render(ui,info,isPanel=false){
    const state=states.get(info.url),signature=JSON.stringify([info,state,preferences.placement]);
    if(ui.dataset.signature===signature)return;
    ui.dataset.signature=signature;ui.replaceChildren();
    if(isPanel){const title=document.createElement('span');title.className='title';title.textContent=info.title;ui.append(title);}
    const button=document.createElement('button');button.type='button';
    button.textContent=active(state)?'Отменить':isPanel?'↓ Скачать текущее видео':preferences.placement==='separate'?'↓ Скачать':'↓';
    button.title='Скачать '+info.title;button.setAttribute('aria-label',active(state)?'Отменить скачивание':'Скачать '+info.title);
    button.addEventListener('click',async e=>{
      e.preventDefault();e.stopPropagation();
      if(routeChanged()){schedule();return;}
      try{const reply=await chrome.runtime.sendMessage({type:active(states.get(info.url))?'yvd-cancel':'yvd-start',url:info.url});if(reply?.error)states.set(info.url,{status:'error',text:reply.error});}
      catch{states.set(info.url,{status:'error',text:'Обновите страницу после обновления расширения.'});}
      paint();
    });
    const status=document.createElement('span');status.className='status';status.setAttribute('aria-live','polite');
    status.textContent=state?.status==='done'?'✓ Сохранено в Загрузки/Яндекс Видео':state?.text||'';
    status.title=state?.filename||status.textContent;ui.append(button,status);
  }
  function paint(){
    for(const item of records.values())render(item.ui,item.info);
    const current=YVD.currentVideo(document,location.href);
    if(!current||!preferences.showCurrentPanel){panel?.remove();panel=null;return;}
    if(!panel){panel=document.createElement('aside');panel.id='yvd-current';panel.className='control panel';panel.setAttribute('aria-label','Скачать текущее видео');ensureRoot().append(panel);}
    render(panel,current,true);
  }
  function measure(card){
    const outer=rectOf(card);
    const boxes=Array.from(card.querySelectorAll('img,video,picture,canvas,[role="img"],[style*="background-image"]')).map(e=>e.getBoundingClientRect?.()).filter(b=>b&&b.width>40&&b.height>25).sort((a,b)=>b.width*b.height-a.width*a.height);
    return {outer,box:boxes[0]||outer};
  }
  function positionAll(){
    // Read all geometry first, then touch only our isolated overlay.
    const positions=Array.from(records.values(),item=>{const measured=measure(item.card);return {item,...measured,shown:visible(measured.outer)&&exposed(item.card,measured.box)};});
    for(const {item,outer,box,shown} of positions){
      const ui=item.ui;if(!ui.style)continue;
      if(!shown){ui.style.display='none';continue;}ui.style.display='flex';
      if(preferences.placement==='separate'){
        ui.style.left=Math.max(4,outer.left)+'px';ui.style.top=Math.max(4,outer.bottom-29)+'px';ui.style.transform='none';
      }else{
        const left=preferences.placement.endsWith('left'),top=preferences.placement.startsWith('top');
        ui.style.left=(left?box.left+6:box.right-6)+'px';ui.style.top=(top?box.top+6:box.bottom-6)+'px';
        ui.style.transform=`translate(${left?'0':'-100%'},${top?'0':'-100%'})`;
      }
      ui.className='control card'+(preferences.placement==='separate'?' separate':'');
    }
  }
  function refresh(){
    routeChanged();
    const wanted=new Map();
    for(const card of document.querySelectorAll('.VideoSnippet, [data-testid="video_card_layout"]'))if(visible(rectOf(card)))wanted.set(card,YVD.extract(card));
    for(const item of YVD.genericCards(document))if(visible(rectOf(item.element))&&!wanted.has(item.element))wanted.set(item.element,item.info);
    for(const [card,item] of records)if(!wanted.get(card)?.url){item.ui.remove();records.delete(card);}
    for(const [card,info] of wanted){
      if(!info?.url)continue;
      let item=records.get(card);
      if(!item){const ui=document.createElement('div');ui.className='control card';ensureRoot().append(ui);item={card,info,ui};records.set(card,item);}
      item.info=info;
    }
    positionAll();paint();
  }
  function schedule(){routeChanged();for(const [card,item] of records)if(card.isConnected===false){item.ui.remove();records.delete(card);}if(timer===null)timer=setTimeout(()=>{timer=null;refresh();},400);}
  new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['href','src','poster']});
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.type==='yvd-state'){states.set(msg.url,msg);paint();return;}
    if(!['yvd-page-info','yvd-download-current'].includes(msg.type))return;
    if(sender?.id!==chrome.runtime.id||sender?.url!==chrome.runtime.getURL('popup.html'))return;
    const current=YVD.currentVideo(document,location.href),url=current?.url||YVD.publicURL(location.href);
    if(msg.type==='yvd-page-info'){reply({supported:true,current,state:states.get(url)||null,cards:records.size,page:{url:YVD.publicURL(location.href),title:document.title.slice(0,200)}});return;}
    if(!url){reply({error:'Откройте публичную страницу с видео.'});return;}
    chrome.runtime.sendMessage({type:active(states.get(url))?'yvd-cancel':'yvd-start',url}).then(reply).catch(()=>reply({error:'Обновите страницу видео.'}));return true;
  });
  chrome.runtime.sendMessage({type:'yvd-status'}).then(list=>{for(const state of list||[])states.set(state.url,state);paint();}).catch(()=>{});
  function apply(values){preferences={placement:placements.has(values.placement)?values.placement:defaults.placement,showCurrentPanel:values.showCurrentPanel===true};positionAll();paint();}
  chrome.storage?.local?.get(defaults).then(apply).catch(()=>{});
  chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&(changes.placement||changes.showCurrentPanel))chrome.storage.local.get(defaults).then(apply);});
  window.addEventListener('scroll',()=>{if(scrollFrame===null){scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;positionAll();});}schedule();},{passive:true});
  window.addEventListener('resize',()=>{positionAll();schedule();});window.addEventListener('popstate',schedule);
  document.addEventListener?.('loadedmetadata',schedule,true);document.addEventListener?.('load',e=>{if(e.target?.tagName==='IMG')schedule();},true);
  window.addEventListener('pagehide',clearControls);
  window.addEventListener('pageshow',schedule);
  setInterval(()=>{if(routeChanged())schedule();else positionAll();},250);
  refresh();
})();
