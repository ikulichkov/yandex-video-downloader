const jobs = new Map();
const HOST = 'ru.local.yandex_video_downloader';
const allowedPage = value => {
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port) return false;
    if((u.hostname==='ya.ru'||u.hostname==='yandex.ru'||u.hostname.endsWith('.yandex.ru'))&&u.pathname.startsWith('/video/')) return true;
    return ['vkvideo.ru','vk.com'].includes(u.hostname) && Boolean(YVD.sourceURL(value));
  }catch{return false;}
};
importScripts('cards.js');
function notify(job, state) {
  job.state={url:job.url,...state};
  chrome.tabs.sendMessage(job.tab,{type:'yvd-state',...job.state}).catch(()=>{});
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(['yvd-helper-status','yvd-open-folder'].includes(msg.type)) {
    if(sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('popup.html')) return;
    const action=msg.type==='yvd-helper-status'?'ping':'open-folder';
    chrome.runtime.sendNativeMessage(HOST,{action}).then(reply).catch(()=>reply({status:'error'}));
    return true;
  }
  if(!sender.tab || !allowedPage(sender.url)) return;
  const tab=sender.tab.id;
  if(msg.type==='yvd-status') {reply([...jobs.values()].filter(j=>j.tab===tab).map(j=>j.state));return;}
  if(msg.type==='yvd-cancel') {
    const job=jobs.get(msg.url);
    if(job?.tab===tab && job.active) {job.port?.postMessage({action:'cancel'});reply({ok:true});}
    return;
  }
  if(msg.type!=='yvd-start') return;
  const url=YVD.sourceURL(msg.url);
  if(!url){reply({error:'Не найден поддерживаемый исходный ролик.'});return;}
  if(jobs.get(url)?.active){reply({error:'Это видео уже скачивается.'});return;}
  if([...jobs.values()].filter(j=>j.active).length>=2){reply({error:'Уже скачиваются два видео. Дождитесь завершения.'});return;}
  // Bound terminal metadata; nothing is persisted as browsing history.
  if(jobs.size>=100) for(const [key,j] of jobs) if(!j.active){jobs.delete(key);break;}
  const job={url,tab,active:true,port:null,state:{}};jobs.set(url,job);
  notify(job,{status:'starting',text:'Соединение…'});
  try {
    const port=chrome.runtime.connectNative(HOST);job.port=port;
    port.onMessage.addListener(m=>{
      if(!['progress','processing','done','error','cancelled'].includes(m.status)) return;
      if(['done','error','cancelled'].includes(m.status))job.active=false;
      notify(job,{status:m.status,text:String(m.text||'').slice(0,300),percent:m.percent,filename:m.filename});
      if(!job.active)port.disconnect();
    });
    port.onDisconnect.addListener(()=>{
      const error=chrome.runtime.lastError;
      if(job.active){job.active=false;notify(job,{status:'error',text:error?'Помощник недоступен. Выполните установку по инструкции расширения.':'Помощник завершился до окончания скачивания.'});}
    });
    port.postMessage({action:'download',url});reply({ok:true});
  } catch {job.active=false;notify(job,{status:'error',text:'Не удалось запустить локальный помощник.'});reply({error:'Помощник недоступен.'});}
});
chrome.tabs.onRemoved.addListener(tab=>{for(const [url,j] of jobs)if(j.tab===tab){if(j.active)j.port?.postMessage({action:'cancel'});else jobs.delete(url);}});
