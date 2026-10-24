(() => {
  const el=id=>document.getElementById(id);
  let tabId=null,helperReady=false,page=null;
  const busy=s=>['starting','progress','processing'].includes(s?.status);
  function render(){
    const current=page?.current,state=page?.state,canTry=Boolean(current||page?.page?.url);
    el('video-title').textContent=current?.title || (page?.supported?'Выберите ролик на странице':'Откройте страницу с видео');
    el('download').disabled=!canTry||!helperReady;
    el('download').textContent=busy(state)?'Отменить скачивание':current?'↓ Скачать видео':'Найти видео на странице';
    el('status').textContent=state?.status==='done'?'✓ Видео сохранено':state?.text||'';
    el('page-hint').textContent=current?'Кнопки у других роликов находятся на самой странице.':page?.cards?`Кнопок скачивания на странице: ${page.cards}. Нажмите кнопку у нужного ролика.`:'Откройте ролик по ссылке ниже. После обновления расширения перезагрузите вкладку.';
  }
  async function readPage(){
    if(tabId===null){page=null;render();return;}
    try{page=await chrome.tabs.sendMessage(tabId,{type:'yvd-page-info'});}catch{page=null;}
    render();
  }
  async function checkHelper(){
    el('helper').textContent='Проверяю помощник…';el('check-helper').disabled=true;
    try{const result=await chrome.runtime.sendMessage({type:'yvd-helper-status'});helperReady=result?.status==='ready';}
    catch{helperReady=false;}
    el('helper').textContent=helperReady?'● Помощник готов':'● Помощник недоступен';
    el('helper').className=helperReady?'ready':'error';el('check-helper').disabled=false;
    el('folder').disabled=!helperReady;render();
  }
  el('download').addEventListener('click',async()=>{
    if(tabId===null)return;
    el('download').disabled=true;
    try{const reply=await chrome.tabs.sendMessage(tabId,{type:'yvd-download-current'});if(reply?.error){el('status').textContent=reply.error;return;}await readPage();}
    catch{el('status').textContent='Обновите страницу видео и откройте расширение снова.';}
    finally{el('download').disabled=!(page?.current||page?.page?.url)||!helperReady;}
  });
  el('folder').addEventListener('click',async()=>{
    el('folder').disabled=true;
    try{const result=await chrome.runtime.sendMessage({type:'yvd-open-folder'});el('folder-status').textContent=result?.status==='done'?'Папка открыта в Finder.':'Не удалось открыть папку. Проверьте связь с помощником.';}
    catch{el('folder-status').textContent='Помощник недоступен.';}
    finally{el('folder').disabled=!helperReady;}
  });
  el('check-helper').addEventListener('click',checkHelper);
  el('version').textContent='v'+chrome.runtime.getManifest().version;
  chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>{tabId=tabs[0]?.id??null;return readPage();}).catch(()=>{page=null;render();});
  if(el('placement')){
    const defaults={placement:'top-left',showCurrentPanel:false};
    chrome.storage.local.get(defaults).then(p=>{el('placement').value=p.placement;el('show-current-panel').checked=p.showCurrentPanel===true;}).catch(()=>{});
    const save=async()=>{
      await chrome.storage.local.set({placement:el('placement').value,showCurrentPanel:el('show-current-panel').checked});
      el('settings-status').textContent='Сохранено. Кнопки на открытых страницах обновятся автоматически.';
    };
    el('placement').addEventListener('change',save);el('show-current-panel').addEventListener('change',save);
  }
  checkHelper();
  setInterval(readPage,1000);
})();
