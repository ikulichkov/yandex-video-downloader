const jobs=new Map();
const downloaded=new Map();
let maxConcurrentDownloads=5,limitChanged=false;
const validLimit=value=>Number.isInteger(value)&&value>=1&&value<=20;
const HOST='ru.local.yandex_video_downloader';
importScripts('cards.js','updates.js');
const allowedPage=value=>Boolean(YVD.publicURL(value));
const terminal=s=>['done','error','cancelled','removed'].includes(s);
const snapshot=j=>({url:j.url,title:j.title||'Видео',quality:j.quality||'best',createdAt:j.createdAt,...j.state});
function persist(){historyReady.then(()=>chrome.storage?.local?.set({downloadHistory:[...jobs.values()].slice(-100).map(snapshot),downloadedVideos:[...downloaded.values()].slice(-1000)})).catch(()=>{});}
const historyReady=(chrome.storage?.local?.get(['downloadHistory','downloadedVideos','maxConcurrentDownloads'])||Promise.resolve({})).then(data=>{
  if(!limitChanged)maxConcurrentDownloads=validLimit(data.maxConcurrentDownloads)?data.maxConcurrentDownloads:5;
  for(const item of (Array.isArray(data.downloadedVideos)?data.downloadedVideos:[]).slice(-1000))if(item&&YVD.publicURL(item.url))downloaded.set(item.url,{url:item.url,status:'done',downloaded:true,filename:typeof item.filename==='string'?item.filename:undefined});
  for(const item of (Array.isArray(data.downloadHistory)?data.downloadHistory:[]).slice(-100)){
    if(!item||!YVD.publicURL(item.url))continue;
    const state={url:item.url,status:terminal(item.status)?item.status:'error',text:terminal(item.status)?String(item.text||'').slice(0,300):'Загрузка прервана перезапуском браузера. Можно повторить.',filename:typeof item.filename==='string'?item.filename:undefined};
    if(state.status==='done')downloaded.set(item.url,{...state,downloaded:true});
    if(!jobs.has(item.url))jobs.set(item.url,{url:item.url,title:String(item.title||'Видео').slice(0,200),quality:item.quality,createdAt:item.createdAt,active:false,tab:null,state});
  }
  while(downloaded.size>1000)downloaded.delete(downloaded.keys().next().value);
}).catch(()=>{});
chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.maxConcurrentDownloads){limitChanged=true;maxConcurrentDownloads=validLimit(changes.maxConcurrentDownloads.newValue)?changes.maxConcurrentDownloads.newValue:5;}});
function notify(job,state){
  if(state.status==='done'){
    downloaded.delete(job.url);downloaded.set(job.url,{url:job.url,status:'done',downloaded:true,filename:state.filename});
    while(downloaded.size>1000)downloaded.delete(downloaded.keys().next().value);
  }
  job.state={url:job.url,...state,downloaded:downloaded.has(job.url)};
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
  if(chrome.storage){historyReady.then(()=>startReady(msg,tab,reply)).catch(()=>reply({error:'Не удалось прочитать настройки загрузок.'}));return true;}
  return startReady(msg,tab,reply);
}
function startReady(msg,tab,reply){
  const url=YVD.publicURL(msg.url);
  if(!url){reply({error:'Не найден поддерживаемый исходный ролик.'});return;}
  if(jobs.get(url)?.active){reply({error:'Это видео уже скачивается.'});return;}
  if([...jobs.values()].filter(j=>j.active).length>=maxConcurrentDownloads){reply({error:`Достигнут лимит одновременных загрузок (${maxConcurrentDownloads}). Дождитесь завершения или измените лимит в окне расширения.`});return;}
  if(jobs.size>=100)for(const [key,j] of jobs)if(!j.active){jobs.delete(key);break;}
  const quality=['best','1080','720','480','360'].includes(msg.quality)?msg.quality:'best';
  const job={url,tab,title:String(msg.title||'Видео').slice(0,200),quality,createdAt:Date.now(),active:true,port:null,state:{}};jobs.set(url,job);
  notify(job,{status:'starting',text:'Соединение…'});
  try{
    const port=chrome.runtime.connectNative(HOST);job.port=port;
    port.onMessage.addListener(m=>{
      if(!['progress','processing','done','error','cancelled'].includes(m.status))return;
      if(m.status==='progress'&&/^https:\/\/music\.yandex\.ru\/album\/\d+\/track\/\d+$/.test(m.completedUrl||'')&&/^https?:\/\/music\.yandex\./.test(job.url)){
        downloaded.set(m.completedUrl,{url:m.completedUrl,status:'done',downloaded:true,filename:m.completedFilename});
        if(m.completedUrl!==job.url&&!jobs.get(m.completedUrl)?.active){
          if(jobs.size>=100)for(const [key,j] of jobs)if(!j.active){jobs.delete(key);break;}
          const child={url:m.completedUrl,title:String(m.completedTitle||'Трек').slice(0,200),quality:'best',createdAt:Date.now(),tab:job.tab,active:false,state:{}};jobs.set(child.url,child);
          notify(child,{status:'done',text:'Трек сохранён',filename:m.completedFilename});
        }
        while(downloaded.size>1000)downloaded.delete(downloaded.keys().next().value);persist();
      }
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
  if(['yvd-downloads','yvd-cancel-job','yvd-remove-job','yvd-retry-job','yvd-open-job','yvd-reveal-job'].includes(msg.type)){
    if(!popup)return;
    historyReady.then(async()=>{
      if(msg.type==='yvd-downloads'){reply([...jobs.values()].map(snapshot).reverse());return;}
      const job=jobs.get(msg.url);if(!job){reply({error:'Загрузка не найдена.'});return;}
      if(['yvd-open-job','yvd-reveal-job'].includes(msg.type)){
        if(job.state.status!=='done'||!job.state.filename){reply({error:'Файл ещё не сохранён.'});return;}
        const result=await chrome.runtime.sendNativeMessage(HOST,{action:msg.type==='yvd-open-job'?'open-file':'reveal-file',filename:job.state.filename});
        reply(result?.status==='done'?{ok:true}:{error:result?.text||'Не удалось открыть файл. Обновите помощник до 2.2.5.'});return;
      }
      if(msg.type==='yvd-cancel-job'){if(job.active)job.port?.postMessage({action:'cancel'});reply({ok:true});return;}
      if(msg.type==='yvd-retry-job'){start({url:job.url,title:job.title,quality:job.quality},job.tab,reply);return;}
      if(job.active){reply({error:'Сначала остановите загрузку.'});return;}
      if(msg.trashFile){
        if(job.state.status!=='done'||!job.state.filename){reply({error:'Нет сохранённого файла.'});return;}
        const result=await chrome.runtime.sendNativeMessage(HOST,{action:'trash-file',filename:job.state.filename});
        if(result?.status!=='done'){reply({error:result?.text||'Не удалось переместить файл в корзину.'});return;}
        downloaded.delete(job.url);
      }
      jobs.delete(job.url);persist();reply({ok:true});
    }).catch(()=>reply({error:'Не удалось выполнить действие.'}));return true;
  }
  if(!sender.tab||!allowedPage(sender.url))return;
  const tab=sender.tab.id;
  if(msg.type==='yvd-status'){
    const respond=()=>{const values=new Map(downloaded);for(const j of jobs.values())if(j.tab===tab)values.set(j.url,{...j.state,downloaded:downloaded.has(j.url)});reply([...values.values()]);};
    if(!chrome.storage){respond();return;}historyReady.then(respond);return true;
  }
  if(msg.type==='yvd-cancel'){const job=jobs.get(msg.url);if(job?.tab===tab&&job.active){job.port?.postMessage({action:'cancel'});reply({ok:true});}return;}
  if(msg.type==='yvd-start')return start(msg,tab,reply);
});
// Closing a source tab must not cancel a download managed in the popup.
chrome.tabs.onRemoved.addListener(tab=>{for(const job of jobs.values())if(job.tab===tab)job.tab=null;});
