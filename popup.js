(() => {
  const el=id=>document.getElementById(id);
  let tabId=null,helperReady=false,page=null,downloadsSignature='';
  const busy=s=>['starting','progress','processing'].includes(s?.status);
  function render(){
    const current=page?.current,state=page?.state,canTry=Boolean(current||page?.page?.url);
    el('video-title').textContent=current?.title || (page?.supported?'Выберите ролик на странице':'Откройте страницу с видео');
    el('download').disabled=!canTry||!helperReady;
    el('download').textContent=busy(state)?'Отменить скачивание':current?(current.media==='audio'?'↓ Скачать трек':'↓ Скачать видео'):'Найти видео на странице';
    el('status').textContent=state?.status==='done'?(current?.media==='audio'?'✓ Трек сохранён':'✓ Видео сохранено'):state?.text||'';
    el('page-hint').textContent=current?'Кнопки у других роликов находятся на самой странице.':page?.cards?`Кнопок скачивания на странице: ${page.cards}. Нажмите кнопку у нужного ролика.`:'Откройте ролик по ссылке ниже. После обновления расширения перезагрузите вкладку.';
  }
  async function readPage(){
    if(tabId===null){page=null;render();return;}
    try{page=await chrome.tabs.sendMessage(tabId,{type:'yvd-page-info'});}catch{page=null;}
    render();
  }
  async function checkHelper(){
    el('helper').textContent='Проверяю помощник…';el('check-helper').disabled=true;
    try{const result=await chrome.runtime.sendMessage({type:'yvd-helper-status'});helperReady=result?.status==='ready';if(el('helper-hint')){
      let outdated=false;
      if(helperReady&&/^\d+\.\d+\.\d+$/.test(result.version||'')){
        const actual=result.version.split('.').map(Number),required=[2,3,2];
        for(let i=0;i<3;i++)if(actual[i]!==required[i]){outdated=actual[i]<required[i];break;}
      }
      el('helper-hint').textContent=outdated?'Помощник '+result.version+': для новых функций обновите его — Windows: install-windows.cmd; macOS: install.command из нового архива.':helperReady?'':result?.text||'Установите локальный помощник: Windows — install-windows.cmd, macOS — install.command из архива расширения.';
    }}
    catch{helperReady=false;if(el('helper-hint'))el('helper-hint').textContent='Нет связи с локальным помощником. Windows: install-windows.cmd; macOS: install.command из архива расширения.';}
    el('helper').textContent=helperReady?'● Помощник готов':'● Помощник недоступен';
    el('helper').className=helperReady?'ready':'error';el('check-helper').disabled=false;
    el('folder').disabled=!helperReady;if(el('install-helper'))el('install-helper').hidden=helperReady;render();
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
    const defaults={placement:'top-left',showCurrentPanel:false,quality:'best'};
    chrome.storage.local.get(defaults).then(p=>{el('placement').value=p.placement;el('show-current-panel').checked=p.showCurrentPanel===true;if(el('quality'))el('quality').value=p.quality||'best';}).catch(()=>{});
    const save=async()=>{
      await chrome.storage.local.set({placement:el('placement').value,showCurrentPanel:el('show-current-panel').checked,quality:el('quality')?.value||'best'});
      el('settings-status').textContent='Сохранено. Кнопки на открытых страницах обновятся автоматически.';
    };
    el('quality')?.addEventListener('change',save);el('placement').addEventListener('change',save);el('show-current-panel').addEventListener('change',save);
  }
  async function checkUpdate(force=false){
    const status=el('update-status'),button=el('check-update'),link=el('download-update');
    button.disabled=true;status.textContent='Проверяю новую версию…';link.hidden=true;
    try{
      const result=await chrome.runtime.sendMessage({type:'yvd-check-update',force});
      status.textContent=result?.available?`Доступна версия ${result.latest} (установлена ${result.current}).${result.status==='error'?' Последняя проверка без сети.':''}`:result?.status==='ok'?`Установлена актуальная версия ${result.current}.`:'Не удалось проверить обновления. Попробуйте позже.';
      if(result?.available){link.href='https://github.com/ikulichkov/yandex-video-downloader/archive/refs/heads/main.zip';link.textContent=`↓ Скачать обновление ${result.latest} · ZIP`;link.hidden=false;}
    }catch{status.textContent='Не удалось проверить обновления. Попробуйте позже.';}
    finally{button.disabled=false;}
  }
  if(el('check-update')){el('check-update').addEventListener('click',()=>checkUpdate(true));checkUpdate();}
  const concurrency=el('max-concurrent-downloads');
  if(concurrency){
    chrome.storage.local.get({maxConcurrentDownloads:5}).then(p=>{concurrency.value=Number.isInteger(p.maxConcurrentDownloads)&&p.maxConcurrentDownloads>=1&&p.maxConcurrentDownloads<=20?p.maxConcurrentDownloads:5;}).catch(()=>{});
    concurrency.addEventListener('change',async()=>{
      const value=Number(concurrency.value),status=el('concurrency-status');
      if(!Number.isInteger(value)||value<1||value>20){concurrency.setAttribute('aria-invalid','true');status.textContent='Введите целое число от 1 до 20.';return;}
      concurrency.setAttribute('aria-invalid','false');
      try{await chrome.storage.local.set({maxConcurrentDownloads:value});status.textContent='Сохранено. Лимит применяется к новым загрузкам; текущие продолжаются.';}
      catch{status.textContent='Не удалось сохранить лимит. Попробуйте ещё раз.';}
    });
  }
  checkHelper();
  async function readDownloads(){
    const list=el('downloads');if(!list)return;
    try{
      const jobs=await chrome.runtime.sendMessage({type:'yvd-downloads'});if(!Array.isArray(jobs))return;
      const signature=JSON.stringify(jobs);if(signature===downloadsSignature)return;downloadsSignature=signature;list.replaceChildren();
      if(!jobs.length){list.textContent='Загрузок пока нет.';return;}list.textContent='';
      for(const job of jobs){
        const row=document.createElement('div');row.className='download-item';
        const title=document.createElement('p');title.textContent=job.title||'Видео';row.append(title);
        const state=document.createElement('p');state.className='muted';state.textContent=job.status==='done'?'✓ Сохранено':job.status==='cancelled'?'Остановлено':job.text||job.status;row.append(state);
        const actions=document.createElement('div');actions.className='download-actions';
        function action(label,type,extra={}){const button=document.createElement('button');button.textContent=label;button.addEventListener('click',async()=>{button.disabled=true;try{const result=await chrome.runtime.sendMessage({type,url:job.url,...extra});el('downloads-status').textContent=result?.error||'';downloadsSignature='';await readDownloads();}catch{el('downloads-status').textContent='Не удалось выполнить действие.';}finally{button.disabled=false;}});actions.append(button);}
        if(busy(job))action('Остановить','yvd-cancel-job');
        else{
          if(job.status!=='done')action('Повторить','yvd-retry-job');
          if(job.status==='done'&&job.filename){action('Открыть','yvd-open-job');action('Показать в папке','yvd-reveal-job');}
          action('Убрать из списка','yvd-remove-job');
          if(job.status==='done'&&job.filename)action('Файл в корзину','yvd-remove-job',{trashFile:true});
        }
        row.append(actions);list.append(row);
      }
    }catch{el('downloads-status').textContent='Не удалось получить список загрузок.';}
  }
  readDownloads();setInterval(()=>{readDownloads();return readPage();},1000);
})();
