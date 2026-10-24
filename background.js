const jobs=new Map();
const HOST='ru.local.yandex_video_downloader';
importScripts('cards.js','updates.js');
const allowedPage=value=>Boolean(YVD.publicURL(value));
const terminal=s=>['done','error','cancelled','removed'].includes(s);
const snapshot=j=>({url:j.url,title:j.title||'Видео',quality:j.quality||'best',createdAt:j.createdAt,...j.state});
function persist(){chrome.storage?.local?.set({downloadHistory:[...jobs.values()].slice(-100).map(snapshot)}).catch(()=>{});}
const historyReady=(chrome.storage?.local?.get('downloadHistory')||Promise.resolve({})).then(data=>{
  for(const item of (Array.isArray(data.downloadHistory)?data.downloadHistory:[]).slice(-100)){
    if(!YVD.publicURL(item.url)||jobs.has(item.url))continue;
    const state={url:item.url,status:terminal(item.status)?item.status:'error',text:terminal(item.status)?String(item.text||'').slice(0,300):'Загрузка прервана перезапуском браузера. Можно повторить.',filename:typeof item.filename==='string'?item.filename:undefined};
    jobs.set(item.url,{url:item.url,title:String(item.title||'Видео').slice(0,200),quality:item.quality,createdAt:item.createdAt,active:false,tab:null,state});
  }
}).catch(()=>{});
function notify(job,state){
  job.state={url:job.url,...state};
  if(job.tab!=null)chrome.tabs.sendMessage(job.tab,{type:'yvd-state',...job.state}).catch(()=>{});
  if(terminal(state.status)||state.status==='starting')persist();
}
function helperError(error){
  const text=String(error?.message||error||'').toLowerCase();
  if(/forbidden|access.*denied/.test(text))return 'Браузер не разрешил доступ к помощнику. Проверьте регистрацию ID расширения.';
  if(/not found|not registered|specified native/.test(text))return 'Помощник не установлен для этого браузера. Windows: запустите install-windows.cmd из архива расширения; macOS: install.command.';
  return 'Помощник завершился до окончания загрузки. Проверьте связь в окне расширения и установку помощника.';
}
function start(msg,tab,reply){
  const url=YVD.publicURL(msg.url);
  if(!url){reply({error:'Не найден поддерживаемый исходный ролик.'});return;}
  if(jobs.get(url)?.active){reply({error:'Это видео уже скачивается.'});return;}
  if([...jobs.values()].filter(j=>j.active).length>=2){reply({error:'Уже скачиваются два видео. Дождитесь завершения.'});return;}
  if(jobs.size>=100)for(const [key,j] of jobs)if(!j.active){jobs.delete(key);break;}
  const quality=['best','1080','720','480','360'].includes(msg.quality)?msg.quality:'best';
  const job={url,tab,title:String(msg.title||'Видео').slice(0,200),quality,createdAt:Date.now(),active:true,port:null,state:{}};jobs.set(url,job);
  notify(job,{status:'starting',text:'Соединение…'});
  try{
    const port=chrome.runtime.connectNative(HOST);job.port=port;
    port.onMessage.addListener(m=>{
      if(!['progress','processing','done','error','cancelled'].includes(m.status))return;
      if(terminal(m.status))job.active=false;
      notify(job,{status:m.status,text:String(m.text||'').slice(0,300),percent:m.percent,filename:m.filename});
      if(!job.active)port.disconnect();
    });
    port.onDisconnect.addListener(()=>{const error=chrome.runtime.lastError;if(job.active){job.active=false;notify(job,{status:'error',text:helperError(error)});}});
    port.postMessage({action:'download',url,quality});reply({ok:true});
  }catch(error){job.active=false;notify(job,{status:'error',text:helperError(error)});reply({error:helperError(error)});}
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  const popup=sender.url===chrome.runtime.getURL?.('popup.html');
  if(['yvd-helper-status','yvd-open-folder'].includes(msg.type)){
    if(!popup)return;
    chrome.runtime.sendNativeMessage(HOST,{action:msg.type==='yvd-helper-status'?'ping':'open-folder'}).then(reply).catch(error=>reply({status:'error',text:helperError(error)}));return true;
  }
  if(['yvd-downloads','yvd-cancel-job','yvd-remove-job','yvd-retry-job'].includes(msg.type)){
    if(!popup)return;
    historyReady.then(async()=>{
      if(msg.type==='yvd-downloads'){reply([...jobs.values()].map(snapshot).reverse());return;}
      const job=jobs.get(msg.url);if(!job){reply({error:'Загрузка не найдена.'});return;}
      if(msg.type==='yvd-cancel-job'){if(job.active)job.port?.postMessage({action:'cancel'});reply({ok:true});return;}
      if(msg.type==='yvd-retry-job'){start({url:job.url,title:job.title,quality:job.quality},job.tab,reply);return;}
      if(job.active){reply({error:'Сначала остановите загрузку.'});return;}
      if(msg.trashFile){
        if(job.state.status!=='done'||!job.state.filename){reply({error:'Нет сохранённого файла.'});return;}
        const result=await chrome.runtime.sendNativeMessage(HOST,{action:'trash-file',filename:job.state.filename});
        if(result?.status!=='done'){reply({error:result?.text||'Не удалось переместить файл в корзину.'});return;}
      }
      jobs.delete(job.url);persist();reply({ok:true});
    }).catch(()=>reply({error:'Не удалось выполнить действие.'}));return true;
  }
  if(!sender.tab||!allowedPage(sender.url))return;
  const tab=sender.tab.id;
  if(msg.type==='yvd-status'){reply([...jobs.values()].filter(j=>j.tab===tab).map(j=>j.state));return;}
  if(msg.type==='yvd-cancel'){const job=jobs.get(msg.url);if(job?.tab===tab&&job.active){job.port?.postMessage({action:'cancel'});reply({ok:true});}return;}
  if(msg.type==='yvd-start')start(msg,tab,reply);
});
// Closing a source tab must not cancel a download managed in the popup.
chrome.tabs.onRemoved.addListener(tab=>{for(const job of jobs.values())if(job.tab===tab)job.tab=null;});
