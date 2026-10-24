/* Fixed public metadata only. No remote code execution or automatic installation. */
(() => {
  const endpoint='https://raw.githubusercontent.com/ikulichkov/yandex-video-downloader/main/manifest.json';
  const archive='https://github.com/ikulichkov/yandex-video-downloader/archive/refs/heads/main.zip';
  const interval=6*60*60*1000,alarm='yvd-update-check';
  function parts(value){return typeof value==='string'&&/^\d{1,5}(\.\d{1,5}){0,3}$/.test(value)?value.split('.').map(Number):null;}
  function newer(remote,local){const a=parts(remote),b=parts(local);if(!a||!b)return false;for(let i=0;i<4;i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);}return false;}
  if(typeof module!=='undefined')module.exports={newer};
  if(typeof chrome==='undefined')return;
  let pending;
  async function check(force=false){
    if(pending)return pending;
    pending=(async()=>{
      const current=chrome.runtime.getManifest().version;
      const saved=(await chrome.storage.local.get('updateCheck')).updateCheck;
      if(!force&&saved?.checkedAt&&Date.now()-saved.checkedAt<interval)return {...saved,current,available:newer(saved.latest,current),archive};
      let result;
      try{
        const response=await fetch(endpoint,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error('http');
        const body=await response.text();if(body.length>32768)throw Error('size');
        const manifest=JSON.parse(body);if(!parts(manifest.version))throw Error('version');
        result={status:'ok',latest:manifest.version,checkedAt:Date.now()};
      }catch{result={status:'error',latest:saved?.latest||null,checkedAt:Date.now()};}
      await chrome.storage.local.set({updateCheck:result});
      return {...result,current,available:newer(result.latest,current),archive};
    })();
    try{return await pending;}finally{pending=null;}
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.type!=='yvd-check-update'||sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html'))return;
    check(msg.force===true).then(reply).catch(()=>reply({status:'error'}));return true;
  });
  chrome.alarms.onAlarm.addListener(a=>{if(a.name===alarm)check().catch(()=>{});});
  chrome.alarms.get(alarm).then(a=>{if(!a)return chrome.alarms.create(alarm,{periodInMinutes:360});}).catch(()=>{});
  check().catch(()=>{});
})();
