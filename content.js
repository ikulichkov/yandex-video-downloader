(() => {
  const states=new Map();
  const active=s=>['starting','progress','processing'].includes(s?.status);
  function render(card,ui,info) {
    ui.replaceChildren();
    const state=info&&states.get(info.url);
    const button=document.createElement('button');button.type='button';button.className='yvd-button';
    button.textContent=active(state)?'Отменить':ui.id==='yvd-current'?'↓ Скачать текущее видео':'↓ Скачать';
    button.disabled=!info;
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
    if(!current) panel?.remove();
    else {
      if(!panel){panel=document.createElement('aside');panel.id='yvd-current';panel.className='yvd-tools';panel.setAttribute('aria-label','Скачать текущее видео');document.body.append(panel);}
      const signature=JSON.stringify([current,states.get(current.url)]);
      if(panel.dataset.signature!==signature){panel.dataset.signature=signature;render(null,panel,current);}
    }
    for(const card of document.querySelectorAll('.VideoSnippet, [data-testid="video_card_layout"]')) {
      const target=card;
      let ui=target.querySelector(':scope > .yvd-tools');
      if(!ui){ui=document.createElement('div');ui.className='yvd-tools';ui.addEventListener('pointerdown',e=>e.stopPropagation());target.append(ui);}
      const info=YVD.extract(card),state=info&&states.get(info.url);
      const signature=JSON.stringify([info,state]);
      if(ui.dataset.signature!==signature){ui.dataset.signature=signature;render(card,ui,info);}
    }
  }
  let timer;
  new MutationObserver(records=>{
    if(records.every(r=>r.target instanceof Element&&r.target.closest('.yvd-tools'))) return;
    clearTimeout(timer);timer=setTimeout(refresh,150);
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['href']});
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.type==='yvd-state'){states.set(msg.url,msg);refresh();return;}
    if(!['yvd-page-info','yvd-download-current'].includes(msg.type)) return;
    if(sender?.id!==chrome.runtime.id || sender?.url!==chrome.runtime.getURL('popup.html')) return;
    const info=YVD.currentVideo(document,location.href);
    if(msg.type==='yvd-page-info'){
      reply({supported:true,current:info,state:info?states.get(info.url)||null:null,cards:document.querySelectorAll('.yvd-tools:not(#yvd-current)').length});return;
    }
    if(!info){reply({error:'Откройте ролик Яндекса или VK Видео.'});return;}
    chrome.runtime.sendMessage({type:active(states.get(info.url))?'yvd-cancel':'yvd-start',url:info.url}).then(reply).catch(()=>reply({error:'Обновите страницу видео.'}));
    return true;
  });
  chrome.runtime.sendMessage({type:'yvd-status'}).then(list=>{for(const s of list||[])states.set(s.url,s);refresh();}).catch(()=>{});
  let lastPage=location.href;
  setInterval(()=>{if(lastPage!==location.href){lastPage=location.href;refresh();}},1000);
  window.addEventListener('popstate',refresh);
  refresh();
})();
