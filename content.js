(() => {
  const states=new Map();
  const defaults={placement:'top-left',showCurrentPanel:false};
  let preferences={...defaults};
  const placements=new Set(['separate','top-left','top-right','bottom-left','bottom-right']);
  const active=s=>['starting','progress','processing'].includes(s?.status);
  function render(card,ui,info) {
    ui.replaceChildren();
    const state=info&&states.get(info.url);
    const button=document.createElement('button');button.type='button';button.className='yvd-button';
    button.textContent=active(state)?'Отменить':ui.id==='yvd-current'?'↓ Скачать текущее видео':preferences.placement==='separate'?'↓ Скачать':'↓';
    button.disabled=!info?.url;button.setAttribute('aria-label',active(state)?'Отменить скачивание':'Скачать '+(info?.title||'видео'));
    button.title=info?'Скачать полное видео с исходного сайта':'Источник этого видео пока не поддерживается';
    button.addEventListener('click',async e=>{
      e.preventDefault();e.stopPropagation();
      try {
        const reply=await chrome.runtime.sendMessage({type:active(states.get(info.url))?'yvd-cancel':'yvd-start',url:info.url});
        if(reply?.error){states.set(info.url,{status:'error',text:reply.error});refresh();}
      }catch{states.set(info.url,{status:'error',text:'Расширение обновлено. Перезагрузите страницу.'});refresh();}
    });
    const status=document.createElement('span');status.className='yvd-status';status.setAttribute('aria-live','polite');
    status.textContent=state?.status==='done'?'✓ Сохранено в Загрузки/Яндекс Видео':state?.text||(!info?'Источник не поддерживается':'');
    status.title=state?.filename||status.textContent;
    if(ui.id==='yvd-current'){const title=document.createElement('span');title.className='yvd-current-title';title.textContent=info.title;ui.append(title);}
    ui.append(button,status);
  }
  function refresh(){
    const current=YVD.currentVideo(document,location.href);
    let panel=document.getElementById('yvd-current');
    if(!current||!preferences.showCurrentPanel) panel?.remove();
    else {
      if(!panel){panel=document.createElement('aside');panel.id='yvd-current';panel.className='yvd-tools';panel.setAttribute('aria-label','Скачать текущее видео');document.body.append(panel);}
      const signature=JSON.stringify([current,states.get(current.url)]);
      if(panel.dataset.signature!==signature){panel.dataset.signature=signature;render(null,panel,current);}
    }
    const cards=new Map();
    for(const card of document.querySelectorAll('.VideoSnippet, [data-testid="video_card_layout"]'))cards.set(card,YVD.extract(card));
    for(const item of YVD.genericCards(document))if(!cards.has(item.element))cards.set(item.element,item.info);
    for(const old of document.querySelectorAll('.yvd-tools[data-placement]'))if(!cards.get(old.parentElement)?.url){old.parentElement?.classList?.remove('yvd-separated');old.remove();}
    for(const [card,info] of cards){
      if(!info?.url)continue;
      if(typeof getComputedStyle==='function'&&getComputedStyle(card).position==='static')card.classList.add('yvd-positioned');
      card.classList?.toggle('yvd-separated',preferences.placement==='separate');
      let ui=card.querySelector(':scope > .yvd-tools');
      if(!ui){ui=document.createElement('div');ui.className='yvd-tools';ui.addEventListener('pointerdown',e=>e.stopPropagation());card.append(ui);}
      ui.dataset.placement=preferences.placement;
      const signature=JSON.stringify([info,states.get(info.url),preferences.placement]);
      if(ui.dataset.signature!==signature){ui.dataset.signature=signature;render(card,ui,info);}
      if(ui.style&&card.getBoundingClientRect){
        for(const key of ['top','right','bottom','left'])ui.style.removeProperty(key);
        if(preferences.placement!=='separate'){
          const outer=card.getBoundingClientRect();
          const boxes=Array.from(card.querySelectorAll('img,video,picture')).map(e=>e.getBoundingClientRect?.()).filter(b=>b&&b.width>30&&b.height>30).sort((a,b)=>b.width*b.height-a.width*a.height);
          const box=boxes[0]||outer;
          if(box.width>30&&box.height>30){
            ui.style[preferences.placement.startsWith('top')?'top':'bottom']=Math.max(0,preferences.placement.startsWith('top')?box.top-outer.top+8:outer.bottom-box.bottom+8)+'px';
            ui.style[preferences.placement.endsWith('left')?'left':'right']=Math.max(0,preferences.placement.endsWith('left')?box.left-outer.left+8:outer.right-box.right+8)+'px';
          }
        }
      }
    }
  }
  let timer;
  new MutationObserver(records=>{
    if(records.every(r=>r.target instanceof Element&&r.target.closest('.yvd-tools'))) return;
    clearTimeout(timer);timer=setTimeout(refresh,400);
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['href']});
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.type==='yvd-state'){states.set(msg.url,msg);refresh();return;}
    if(!['yvd-page-info','yvd-download-current'].includes(msg.type)) return;
    if(sender?.id!==chrome.runtime.id || sender?.url!==chrome.runtime.getURL('popup.html')) return;
    const info=YVD.currentVideo(document,location.href);
    if(msg.type==='yvd-page-info'){
      reply({supported:true,current:info,state:states.get(info?.url||YVD.publicURL(location.href))||null,cards:document.querySelectorAll('.yvd-tools:not(#yvd-current)').length,page:{url:YVD.publicURL(location.href),title:document.title.slice(0,200)}});return;
    }
    const selected=info||{url:YVD.publicURL(location.href),title:document.title};
    if(!selected.url){reply({error:'Откройте публичную страницу с видео.'});return;}
    chrome.runtime.sendMessage({type:active(states.get(selected.url))?'yvd-cancel':'yvd-start',url:selected.url}).then(reply).catch(()=>reply({error:'Обновите страницу видео.'}));
    return true;
  });
  chrome.runtime.sendMessage({type:'yvd-status'}).then(list=>{for(const s of list||[])states.set(s.url,s);refresh();}).catch(()=>{});
  let lastPage=location.href;
  setInterval(()=>{if(lastPage!==location.href){lastPage=location.href;refresh();}},1000);
  function applyPreferences(values){preferences={placement:placements.has(values.placement)?values.placement:defaults.placement,showCurrentPanel:values.showCurrentPanel===true};refresh();}
  chrome.storage?.local?.get(defaults).then(applyPreferences).catch(()=>{});
  chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&(changes.placement||changes.showCurrentPanel))chrome.storage.local.get(defaults).then(applyPreferences);});
  window.addEventListener('popstate',refresh);
  window.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(refresh,400);},{passive:true});
  document.addEventListener?.('loadedmetadata',refresh,true);
  document.addEventListener?.('load',e=>{if(e.target?.tagName==='IMG'){clearTimeout(timer);timer=setTimeout(refresh,400);}},true);
  window.addEventListener('resize',refresh);
  refresh();
})();
