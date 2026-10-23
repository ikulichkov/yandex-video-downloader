(() => {
  const states=new Map();
  const active=s=>['starting','progress','processing'].includes(s?.status);
  function render(card,ui,info) {
    ui.replaceChildren();
    const state=info&&states.get(info.url);
    const button=document.createElement('button');button.type='button';button.className='yvd-button';
    button.textContent=active(state)?'Отменить':'↓ Скачать';
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
    ui.append(button,status);
  }
  function refresh(){
    for(const card of document.querySelectorAll('.VideoSnippet')) {
      let ui=card.querySelector(':scope > .yvd-tools');
      if(!ui){ui=document.createElement('div');ui.className='yvd-tools';card.append(ui);}
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
  chrome.runtime.onMessage.addListener(msg=>{if(msg.type==='yvd-state'){states.set(msg.url,msg);refresh();}});
  chrome.runtime.sendMessage({type:'yvd-status'}).then(list=>{for(const s of list||[])states.set(s.url,s);refresh();}).catch(()=>{});
  refresh();
})();
