(() => {
  const states=new Map(),records=new Map();
  const defaults={placement:'top-left',showCurrentPanel:false,quality:'best'};
  const placements=new Set(['separate','top-left','top-right','bottom-left','bottom-right']);
  let preferences={...defaults},host,root,panel,timer=null,scrollFrame=null;
  const music=typeof YVM!=='undefined'?YVM:null;
  const currentInfo=()=>music?.current(document,location.href)||YVD.currentVideo(document,location.href);
  const active=s=>['starting','progress','processing'].includes(s?.status);
  const rectOf=e=>e.getBoundingClientRect?.()||{left:0,top:0,right:160,bottom:90,width:160,height:90};
  const visible=r=>r.width>40&&r.height>25&&r.bottom>=0&&r.top<(typeof innerHeight==='number'?innerHeight:2000)+100;
  let pageURL=location.href;
  const adwait=typeof YVA!=='undefined'?YVA.create():null;
  let videoActions=null,waitText='';
  function clearAdControls(){adwait?.cancel();videoActions?.ui.remove();videoActions=null;waitText='';}
  function clearControls(){clearAdControls();for(const item of records.values())item.ui.remove();records.clear();panel?.remove();panel=null;}
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
      button.downloaded{background:#62d991;color:#103a20}button.downloaded:hover{background:#8be8ae}
      .status{background:#252525;color:#f5f5f5;border-radius:5px;padding:3px 6px;overflow-wrap:anywhere;max-width:235px}.status:empty{display:none}
      .separate button,.panel button{font-size:12px;padding:8px 11px}.separate{max-width:260px}
      .panel{right:20px;bottom:20px;left:auto;top:auto;max-width:320px;padding:13px;border:1px solid #777;border-radius:13px;background:#202124;box-shadow:0 4px 20px #0006;gap:9px}
      .video-actions{max-width:260px}.video-actions button{font-size:12px;padding:8px 10px}.video-actions .buttons{display:flex;gap:5px;pointer-events:none}.video-actions .status{max-width:250px}
      .music button{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:#ffdf00;color:#080808;border:0;box-shadow:0 2px 6px #0005;font-weight:900;width:30px;height:30px;padding:5px}.music button:hover{background:#ffed69}.music button svg{width:20px;height:20px;stroke:currentColor;stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round;fill:none}.music.album button{width:auto;height:auto;gap:6px}.music.album button{border-radius:20px;font-size:12px;padding:10px 14px}.music button.downloaded{background:#62d991;color:#103a20}.title{font-weight:600}.panel .status{background:none;padding:0}
    `;root.append(style);(document.documentElement||document.body).append(host);return root;
  }
  function render(ui,info,isPanel=false){
    const state=states.get(info.url),signature=JSON.stringify([info,state,preferences.placement]);
    if(ui.dataset.signature===signature)return;
    ui.dataset.signature=signature;ui.replaceChildren();
    if(isPanel){const title=document.createElement('span');title.className='title';title.textContent=info.title;ui.append(title);}
    const button=document.createElement('button');button.type='button';
    const saved=state?.status==='done'||state?.downloaded===true;
    button.className=saved&&!active(state)?'downloaded':'';
    button.textContent=info.musicPosition?(active(state)?(info.media==='album'?'■ Остановить альбом':'■'):saved?'✓':info.media==='album'?'↓ Скачать альбом':'↓'):active(state)?'Отменить':saved?(isPanel||preferences.placement==='separate'?'✓ Скачано · Скачать ещё':'✓'):isPanel?'↓ Скачать текущее видео':preferences.placement==='separate'?'↓ Скачать':'↓';
    if(info.media==='album'&&active(state)&&Number.isFinite(state.percent))button.textContent+=' '+state.percent+'%';
    if(info.musicPosition&&!active(state)&&!saved&&info.media!=='album'&&document.createElementNS){
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M12 3v15m-6-6 6 6 6-6M5 21h14');svg.append(path);button.replaceChildren(svg);
    }
    button.title='Скачать '+(info.media==='album'?'альбом: ':'')+info.title;button.setAttribute('aria-label',active(state)?'Отменить скачивание':'Скачать '+info.title);
    if(saved&&!active(state)){button.title='Уже скачано. Скачать ещё: '+info.title;button.setAttribute('aria-label',button.title);}
    button.addEventListener('click',async e=>{
      e.preventDefault();e.stopPropagation();
      if(routeChanged()){schedule();return;}
      const item=[...records.values()].find(x=>x.ui===ui);
      if(item&&!bound(item)){if(ui.style)ui.style.display='none';schedule();return;}
      try{const reply=await chrome.runtime.sendMessage({type:active(states.get(info.url))?'yvd-cancel':'yvd-start',url:info.url,title:info.title,quality:preferences.quality});if(reply?.error)states.set(info.url,{status:'error',text:reply.error});}
      catch{states.set(info.url,{status:'error',text:'Обновите страницу после обновления расширения.'});}
      paint();
    });
    const status=document.createElement('span');status.className='status';status.setAttribute('aria-live','polite');
    status.textContent=state?.status==='done'?(isPanel?'✓ Сохранено в Загрузки/Яндекс Видео':''):state?.text||'';
    status.title=state?.filename||status.textContent;ui.append(button,status);
  }
  function paint(){
    paintVideoActions();
    for(const item of records.values())render(item.ui,item.info);
    const current=currentInfo();
    if(videoActions&&current?.url===videoActions.info.url){panel?.remove();panel=null;return;}
    if(!current||!preferences.showCurrentPanel){panel?.remove();panel=null;return;}
    if(!panel){panel=document.createElement('aside');panel.id='yvd-current';panel.className='control panel';panel.setAttribute('aria-label','Скачать текущее видео');ensureRoot().append(panel);}
    render(panel,current,true);
  }
  function bound(item){return !item.info.musicPosition||!music?.matches||music.matches(item.card,item.info,document,location.href);}
  function measure(card,info){
    const outer=rectOf(card);
    if(info?.musicPosition)return {outer,box:outer};
    const boxes=Array.from(card.querySelectorAll('img,video,picture,canvas,[role="img"],[style*="background-image"]')).map(e=>e.getBoundingClientRect?.()).filter(b=>b&&b.width>40&&b.height>25).sort((a,b)=>b.width*b.height-a.width*a.height);
    return {outer,box:boxes[0]||outer};
  }
  function positionAll(){
    // Read all geometry first, then touch only our isolated overlay.
    const positions=Array.from(records.values(),item=>{const measured=measure(item.card,item.info);return {item,...measured,shown:!(videoActions&&!item.info.musicPosition&&(item.info.url===videoActions.info.url||item.card.contains?.(videoActions.video)))&&bound(item)&&visible(measured.outer)&&exposed(item.card,measured.box)};});
    positionVideoActions();
    for(const {item,outer,box,shown} of positions){
      const ui=item.ui;if(!ui.style)continue;
      if(!shown){ui.style.display='none';continue;}ui.style.display='flex';
      if(item.info.musicPosition){
        const kind=item.info.musicPosition;
        ui.style.left=(kind==='track'?Math.max(4,outer.left-28):kind==='album'?Math.min(outer.right-150,item.card.lastElementChild?.getBoundingClientRect?.().right+8||outer.right-150):kind==='wave'?outer.right-76:Math.min(outer.right-40,outer.left+outer.width*.67))+'px';
        ui.style.top=(kind==='track'?outer.top+(outer.height-28)/2:kind==='wave'?outer.top+Math.max(4,outer.height*.60-15):outer.top+Math.max(0,(outer.height-30)/2))+'px';ui.style.transform='none';
      }else if(preferences.placement==='separate'){
        ui.style.left=Math.max(4,outer.left)+'px';ui.style.top=Math.max(4,outer.bottom-29)+'px';ui.style.transform='none';
      }else{
        const left=preferences.placement.endsWith('left'),top=preferences.placement.startsWith('top');
        ui.style.left=(left?box.left+6:box.right-6)+'px';ui.style.top=(top?box.top+6:box.bottom-6)+'px';
        ui.style.transform=`translate(${left?'0':'-100%'},${top?'0':'-100%'})`;
      }
      ui.className='control card'+(item.info.musicPosition?' music '+item.info.musicPosition:'')+(preferences.placement==='separate'?' separate':'');
    }
  }
  function refresh(){
    routeChanged();
    const wanted=new Map();
    for(const item of music?.controls(document,location.href)||[])if(visible(rectOf(item.element)))wanted.set(item.element,item.info);
    for(const card of document.querySelectorAll('.VideoSnippet, [data-testid="video_card_layout"]'))if(visible(rectOf(card)))wanted.set(card,YVD.extract(card));
    for(const item of YVD.genericCards(document))if(visible(rectOf(item.element))&&!wanted.has(item.element))wanted.set(item.element,item.info);
    for(const [card,item] of records)if(!wanted.get(card)?.url){item.ui.remove();records.delete(card);}
    for(const [card,info] of wanted){
      if(!info?.url)continue;
      let item=records.get(card);
      if(!item){const ui=document.createElement('div');ui.className='control card';ensureRoot().append(ui);item={card,info,ui};records.set(card,item);}
      item.info=info;
    }
    syncVideoActions();positionAll();paint();
  }
  function videoRoot(video){
    const known=video.closest?.('.video-js,.html5-video-player,[data-player]');if(known)return known;
    const parent=video.parentElement;if(parent){const box=rectOf(parent),r=rectOf(video);if(box.width>0&&box.width<=r.width+80&&box.height>0&&box.height<=r.height+150)return parent;}return video;
  }
  function syncVideoActions(){
    if(!adwait||/^https?:\/\/music\.yandex\./.test(location.href)){clearAdControls();return;}
    if(adwait.view().state==='waiting'&&videoActions)return;
    const candidates=[...document.querySelectorAll('video')].filter(v=>{const r=rectOf(v);return r.width>=240&&r.height>=135&&visible(r)&&exposed(videoRoot(v),r)&&!v.closest?.('.VideoSnippet,[data-testid="video_card_layout"]');});
    const current=YVD.currentVideo(document,location.href);
    if(!candidates.length||!current&&candidates.length!==1){clearAdControls();return;}
    candidates.sort((a,b)=>rectOf(b).width*rectOf(b).height-rectOf(a).width*rectOf(a).height);
    const video=candidates[0],info=current||{url:YVD.publicURL(location.href),title:document.title};
    if(!info.url)return;
    if(videoActions?.video===video&&videoActions.info.url===info.url)return;
    clearAdControls();const ui=document.createElement('aside');ui.className='control video-actions';ui.setAttribute('aria-label','Скачивание видео');ensureRoot().append(ui);
    videoActions={video,root:videoRoot(video),info,ui};paintVideoActions();
  }
  function positionVideoActions(){
    if(!videoActions?.ui.style)return;
    if(preferences.showCurrentPanel){videoActions.ui.style.display='flex';videoActions.ui.style.left='auto';videoActions.ui.style.top='auto';videoActions.ui.style.right='20px';videoActions.ui.style.bottom='20px';return;}
    videoActions.ui.style.right='auto';videoActions.ui.style.bottom='auto';
    const r=rectOf(videoActions.video),shown=visible(r)&&exposed(videoRoot(videoActions.video),r);
    videoActions.ui.style.display=shown?'flex':'none';
    videoActions.ui.style.left=Math.max(4,r.right-260)+'px';videoActions.ui.style.top=Math.max(4,r.top+8)+'px';
  }
  async function startVideoRequest(request){
    const owner=videoActions;if(owner)owner.starting=true;paintVideoActions();
    try{const reply=await chrome.runtime.sendMessage({type:'yvd-start',url:request.url,title:request.title,quality:request.quality,mediaUrl:request.mediaUrl});if(videoActions===owner)waitText=reply?.error||'';}
    catch{if(videoActions===owner)waitText='Обновите страницу после обновления расширения.';}
    if(videoActions===owner&&owner)owner.starting=false;paintVideoActions();
  }
  function tickAdWait(){
    if(!adwait||!videoActions||adwait.view().state!=='waiting')return;
    let video=videoActions.video;
    if(video.isConnected===false&&videoActions.root!==video&&videoActions.root.isConnected!==false){
      const replacements=[...videoActions.root.querySelectorAll('video')].filter(v=>v.isConnected!==false&&visible(rectOf(v)));
      if(replacements.length===1)video=videoActions.video=replacements[0];
    }
    const current=YVD.currentVideo(document,location.href);
    const request=adwait.observe({page:location.href,source:current?.url,connected:video.isConnected!==false,ad:YVA.isAd(video),playing:video.paused===false&&!video.ended&&video.readyState>=2,time:video.currentTime,media:video.currentSrc||video.src||'',now:Date.now()});
    if(request)startVideoRequest(request);
    paintVideoActions();
  }
  function paintVideoActions(){
    if(!videoActions||!adwait)return;
    const {ui,info}=videoActions,view=adwait.view(),waiting=view.state==='waiting',state=states.get(info.url),busy=active(state);
    const text=waitText||(waiting?(view.phase==='ad'?'Жду окончания рекламы…':view.phase==='source'?'Жду начала основного видео и ссылки на поток…':'Проверяю готовность потока…'):view.state==='expired'?'Ссылка не появилась за 5 минут. Повторите после начала ролика.':view.state==='changed'?'Ожидание отменено: плеер или ролик сменился.':state?.text||'');
    const signature=JSON.stringify([view,state,text,preferences.showCurrentPanel,videoActions.starting]);if(ui.dataset.signature===signature)return;ui.dataset.signature=signature;ui.replaceChildren();
    ui.className='control video-actions'+(preferences.showCurrentPanel?' panel':'');
    const buttons=document.createElement('div');buttons.className='buttons';
    const button=document.createElement('button');button.type='button';button.disabled=videoActions.starting===true&&!busy;button.textContent=busy?'Отменить загрузку':waiting?'Отменить ожидание':'↓ Скачать видео';
    button.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();if(routeChanged())return;
      if(busy){await chrome.runtime.sendMessage({type:'yvd-cancel',url:info.url});return;}
      if(adwait.view().state==='waiting'){adwait.cancel();waitText='';paintVideoActions();return;}
      const current=YVD.currentVideo(document,location.href);if(current&&current.url!==info.url){clearAdControls();schedule();return;}
      waitText='';adwait.arm({...info,page:location.href,quality:preferences.quality,requireAd:false},Date.now());tickAdWait();paintVideoActions();
    });
    const status=document.createElement('span');status.className='status';status.setAttribute('aria-live','polite');status.textContent=text;buttons.append(button);ui.append(buttons,status);
  }
  function schedule(){routeChanged();for(const [card,item] of records)if(card.isConnected===false){item.ui.remove();records.delete(card);}if(timer===null)timer=setTimeout(()=>{timer=null;refresh();},400);}
  new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['href','src','poster','data-ad','data-is-ad','aria-label']});
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.type==='yvd-state'){states.set(msg.url,msg);paint();return;}
    if(!['yvd-page-info','yvd-download-current'].includes(msg.type))return;
    if(sender?.id!==chrome.runtime.id||sender?.url!==chrome.runtime.getURL('popup.html'))return;
    const current=currentInfo(),url=current?.url||YVD.publicURL(location.href);
    if(msg.type==='yvd-page-info'){reply({supported:true,current,state:states.get(url)||null,cards:records.size,page:{url:YVD.publicURL(location.href),title:document.title.slice(0,200)}});return;}
    if(!url){reply({error:'Откройте публичную страницу с видео.'});return;}
    chrome.runtime.sendMessage({type:active(states.get(url))?'yvd-cancel':'yvd-start',url,title:current?.title||document.title,quality:preferences.quality}).then(reply).catch(()=>reply({error:'Обновите страницу видео.'}));return true;
  });
  function syncStates(){chrome.runtime.sendMessage({type:'yvd-status'}).then(list=>{states.clear();for(const state of list||[])states.set(state.url,state);paint();}).catch(()=>{});}
  syncStates();
  function apply(values){preferences={placement:placements.has(values.placement)?values.placement:defaults.placement,showCurrentPanel:values.showCurrentPanel===true,quality:['best','1080','720','480','360'].includes(values.quality)?values.quality:'best'};positionAll();paint();}
  chrome.storage?.local?.get(defaults).then(apply).catch(()=>{});
  chrome.storage?.onChanged?.addListener((changes,area)=>{if(area!=='local')return;if(changes.placement||changes.showCurrentPanel||changes.quality)chrome.storage.local.get(defaults).then(apply);if(changes.downloadedVideos)syncStates();});
  function onScroll(){
    if(scrollFrame===null)scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;positionAll();});
    schedule();
  }
  // Element scroll events do not bubble: capture nested/virtual list scrolling.
  document.addEventListener?.('scroll',onScroll,{capture:true,passive:true});
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',()=>{positionAll();schedule();});window.addEventListener('popstate',schedule);
  document.addEventListener?.('loadedmetadata',schedule,true);document.addEventListener?.('load',e=>{if(e.target?.tagName==='IMG')schedule();},true);
  window.addEventListener('pagehide',clearControls);
  window.addEventListener('pageshow',schedule);
  setInterval(()=>{if(routeChanged())schedule();else {tickAdWait();positionAll();}},250);
  refresh();
})();
