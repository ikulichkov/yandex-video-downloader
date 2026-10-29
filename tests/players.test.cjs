const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const YVD=require('../cards.js');
const dzen='https://dzen.ru/video/watch/60a95202b5c7ac20986b6ef6';
const vk='https://vkvideo.ru/video-234113842_456242445';
function details(url,visible=true){return {getClientRects:()=>visible?[{}]:[],querySelectorAll:()=>[{href:url}],querySelector:()=>({textContent:'Текущее видео'})};}
test('Yandex preview takes visible current player source, never a related card',()=>{
 const hidden=details('https://ok.ru/video/99',false),visible=details(dzen.replace('https:','http:'));
 const doc={querySelectorAll:s=>{assert.equal(s,'.VideoViewer-Details');return[hidden,visible]}};
 assert.equal(YVD.currentVideo(doc,'https://ya.ru/video/preview/1746664196934773455').url,dzen);
 assert.equal(YVD.currentVideo({querySelectorAll:()=>[]},'https://ya.ru/video/preview/1'),null);
 assert.equal(YVD.currentVideo(doc,'https://ya.ru/video/search'),null);
 assert.equal(YVD.currentVideo(doc,'https://example.com/video/preview/1').url,'https://example.com/video/preview/1');
});
test('VK uses current URL, ignores recommendation links, leaves non-video routes',()=>{
 const doc={title:'VK current',querySelector:()=>null,querySelectorAll:()=>{throw Error('must not inspect recommendations')}};
 assert.deepEqual(YVD.currentVideo(doc,vk),{url:vk,title:'VK current'});
 assert.equal(YVD.currentVideo(doc,'https://vkvideo.ru/'),null);
 assert.equal(YVD.currentVideo(doc,'https://vkvideo.ru/video-123_456').url,'https://vkvideo.ru/video-123_456');
 assert.equal(YVD.currentVideo(doc,'https://example.com/video-123_456').url,'https://example.com/video-123_456');
});
test('source checks and existing search extraction retained',()=>{
 for(const bad of ['file:///tmp/a','https://ok.ru:123/video/1','https://u:p@ok.ru/video/1','https://ok.ru.evil.test/video/1'])assert.equal(YVD.sourceURL(bad),null);
 assert.equal(YVD.extract(details('http://ok.ru/video/123')).url,'https://ok.ru/video/123');
});
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn)}});
test('worker accepts exact VK video and Yandex; rejects other senders; keeps progress/cancel',()=>{
 const ports=[],sent=[];
 const chrome={runtime:{onMessage:event(),lastError:null,connectNative(){const p={onMessage:event(),onDisconnect:event(),sent:[],postMessage(m){this.sent.push(m)},disconnect(){for(const f of this.onDisconnect.listeners)f()}};ports.push(p);return p}},tabs:{onRemoved:event(),sendMessage(tab,m){sent.push(m);return Promise.resolve()}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),{chrome,URL,YVD,Map,importScripts(){}});
 const listener=chrome.runtime.onMessage.listeners[0];
 function send(type,url,senderURL=vk,quality='best'){let reply;listener({type,url,quality},{tab:{id:1},url:senderURL},x=>reply=x);return reply;}
 assert.equal(send('yvd-start',vk,'https://localhost/video-123_456'),undefined);
 assert.equal(send('yvd-start',vk,'file:///tmp/page'),undefined);
 assert.ok(Array.isArray(send('yvd-status',null,'https://vkvideo.ru/')));
 assert.equal(ports.length,0);
 assert.ok(send('yvd-start',vk).ok);assert.equal(ports.length,1);
 assert.ok(send('yvd-start',vk).error);assert.equal(ports.length,1);
 ports[0].onMessage.listeners[0]({status:'progress',percent:50,text:'50%'});assert.equal(sent.at(-1).percent,50);
 assert.ok(send('yvd-cancel',vk).ok);assert.equal(ports[0].sent.at(-1).action,'cancel');
 ports[0].onMessage.listeners[0]({status:'done',filename:'file.mp4'});assert.equal(sent.at(-1).status,'done');
 assert.ok(send('yvd-start',dzen,'https://ya.ru/video/preview/1','720').ok);assert.equal(ports.at(-1).sent[0].quality,'720');
});
function findUI(node,id){if(node.id===id)return node;for(const child of [...node.children,...(node.shadowRoot?[node.shadowRoot]:[])]){const found=findUI(child,id);if(found)return found;}return undefined;}
function cardControls(body){return body.children.flatMap(h=>h.shadowRoot?.children||[]).filter(x=>(x.className||'').split(' ').includes('card'));}
class El{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.listeners={};this.attrs={};this.parent=null;this.style={};}
 attachShadow(){this.shadowRoot=new El('shadow');return this.shadowRoot;}
 append(...items){for(const x of items){x.parent=this;this.children.push(x)}}
 replaceChildren(){this.children=[]}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(k,fn){this.listeners[k]=fn}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)}
}
test('current-video panel updates across SPA routes, sends exact URL, and removes on leaving video',async()=>{
 const body=new El('body'),requests=[],loc={href:vk};let interval,receive;
 const doc={body,title:'VK current',createElement:tag=>new El(tag),getElementById:id=>findUI(body,id),querySelector:()=>null,querySelectorAll:()=>[]};
 const chrome={runtime:{onMessage:{addListener:f=>receive=f},sendMessage:async m=>{requests.push(m);return m.type==='yvd-status'?[]:{ok:true}}}};
 let storageChanged;const prefs={placement:'top-left',showCurrentPanel:true,quality:'480'};chrome.storage={local:{get:async()=>prefs},onChanged:{addListener:f=>storageChanged=f}};
 const context={document:doc,location:loc,chrome,YVD,Element:El,Map,JSON,MutationObserver:class{observe(){}},window:{addEventListener(){}},setInterval:f=>interval=f,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),context);
 await Promise.resolve();
 let panel=doc.getElementById('yvd-current');assert.ok(panel);assert.equal(body.children.length,1);
 let button=panel.children.find(x=>x.tag==='button');assert.equal(button.textContent,'↓ Скачать текущее видео');
 await button.listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).url,vk);assert.equal(requests.at(-1).quality,'480');
 receive({type:'yvd-state',url:vk,status:'progress',text:'50%'});
 button=panel.children.find(x=>x.tag==='button');assert.equal(button.textContent,'Отменить');
 await button.listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).type,'yvd-cancel');
 loc.href='https://vkvideo.ru/video-123_456';interval();await new Promise(r=>setTimeout(r,450));panel=doc.getElementById('yvd-current');assert.equal(body.children.length,1);
 button=panel.children.find(x=>x.tag==='button');await button.listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).url,loc.href);
 loc.href='https://vkvideo.ru/';interval();await new Promise(r=>setTimeout(r,450));assert.equal(doc.getElementById('yvd-current'),undefined);
 loc.href=vk;prefs.showCurrentPanel=false;storageChanged({showCurrentPanel:{newValue:false}},'local');await Promise.resolve();assert.equal(doc.getElementById('yvd-current'),undefined);
 prefs.showCurrentPanel=true;storageChanged({showCurrentPanel:{newValue:true}},'local');await Promise.resolve();assert.ok(doc.getElementById('yvd-current'));
});
test('manifest identity retained; code parses; exact requested video pages covered',()=>{
 const manifest=JSON.parse(fs.readFileSync(require.resolve('../manifest.json'),'utf8'));
 const crypto=require('node:crypto'),hex=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32);
 assert.equal([...hex].map(x=>String.fromCharCode(97+parseInt(x,16))).join(''),'hdokhbookocbnojobgeihfenlfgkfchh');
 assert.deepEqual(manifest.permissions,['nativeMessaging','storage','alarms']);
 assert.deepEqual(manifest.host_permissions,['https://raw.githubusercontent.com/*']);
 assert.ok(manifest.content_scripts[0].matches.includes('https://*/*'));
 for(const file of ['cards.js','content.js','background.js'])new vm.Script(fs.readFileSync(require.resolve('../'+file),'utf8'));
});
test('VK sidebar controls use their own card, do not navigate player, and survive dynamic updates without duplicates',async()=>{
 const body=new El('body'),requests=[],cards=[];let changed,receive;
 function makeCard(url,title){
  const card=new El('div'),info=new El('div');card.url=url;card.videoTitle=title;
  card.querySelector=s=>s===':scope > .yvd-tools'?card.children.find(x=>x.className==='yvd-tools'):{textContent:card.videoTitle};
  card.querySelectorAll=()=>[{href:card.url}];
  info.querySelector=()=>info.children.find(x=>x.className==='yvd-tools');
  card.append(info);return {card,info};
 }
 const first=makeCard('https://vkvideo.ru/video-234113842_456242432','Боковой ролик');cards.push(first.card);
 const loc={href:vk};
 const doc={body,title:'Основной ролик',createElement:tag=>new El(tag),getElementById:id=>findUI(body,id),querySelector:()=>null,querySelectorAll:s=>s.includes('video_card_layout')?cards:[]};
 const chrome={runtime:{onMessage:{addListener:f=>receive=f},sendMessage:async m=>{requests.push(m);return m.type==='yvd-status'?[]:{ok:true}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),{document:doc,location:loc,chrome,YVD,Element:El,Map,JSON,MutationObserver:class{constructor(f){changed=f}observe(){}},window:{addEventListener(){}},setInterval(){},setTimeout(f){f();return 0},clearTimeout(){}});
 await Promise.resolve();
 assert.equal(first.card.children.length,1);assert.equal(cardControls(body).length,1);
 let ui=cardControls(body)[0],button=ui.children.find(x=>x.tag==='button');
 await button.listeners.click({preventDefault(){},stopPropagation(){}});
 assert.equal(requests.at(-1).url,first.card.url);assert.equal(loc.href,vk);
 receive({type:'yvd-state',url:first.card.url,status:'progress',text:'50%'});
 assert.equal(first.card.children.length,1);assert.equal(cardControls(body).length,1);assert.equal(cardControls(body)[0].children.find(x=>x.tag==='button').textContent,'Отменить');
 const second=makeCard('https://vkvideo.ru/video-123_999','Подгруженный ролик');cards.push(second.card);changed([{target:{}}]);
 assert.equal(first.card.children.length,1);assert.equal(second.card.children.length,1);assert.equal(cardControls(body).length,2);
 button=cardControls(body)[1].children.find(x=>x.tag==='button');await button.listeners.click({preventDefault(){},stopPropagation(){}});
 assert.equal(requests.at(-1).url,second.card.url);assert.equal(loc.href,vk);
});
test('popup native commands require exact own popup sender, never accept an input path',async()=>{
 const native=[],id='test-extension',chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,onMessage:event(),sendNativeMessage:async(host,msg)=>{native.push(msg);return {status:'ready'}}},tabs:{onRemoved:event()}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),{chrome,URL,YVD,Map,importScripts(){}});
 const listener=chrome.runtime.onMessage.listeners[0];let result;
 const popup={id,url:chrome.runtime.getURL('popup.html')};
 listener({type:'yvd-open-folder',path:'/etc'},{id,url:'https://vkvideo.ru/video-123_456'},x=>result=x);assert.equal(native.length,0);
 listener({type:'yvd-open-folder',path:'/etc'},{id:'other',url:popup.url},x=>result=x);assert.equal(native.length,0);
 assert.equal(listener({type:'yvd-helper-status'},popup,x=>result=x),true);await Promise.resolve();assert.equal(native.at(-1).action,'ping');assert.equal(result.status,'ready');
 listener({type:'yvd-open-folder',path:'/etc'},popup,x=>result=x);await Promise.resolve();assert.equal(JSON.stringify(native.at(-1)),JSON.stringify({action:'open-folder'}));
});
test('popup shows current video, forwards download/cancel, probes helper and opens fixed folder',async()=>{
 const elements=new Map(),requests=[];let poll;
 for(const id of ['video-title','download','status','page-hint','helper','check-helper','folder','folder-status','version','placement','show-current-panel','settings-status'])elements.set(id,new El('div'));
 const doc={getElementById:id=>elements.get(id)},page={supported:true,current:{url:vk,title:'Текущий VK'},state:null};
 const chrome={runtime:{getManifest:()=>({version:'1.2.0'}),sendMessage:async msg=>{requests.push(msg);return {status:msg.type==='yvd-helper-status'?'ready':'done'}}},tabs:{query:async q=>{assert.deepEqual(JSON.parse(JSON.stringify(q)),{active:true,currentWindow:true});return[{id:9}]},sendMessage:async(id,msg)=>{assert.equal(id,9);requests.push(msg);if(msg.type==='yvd-page-info')return page;page.state={status:page.state?'cancelled':'progress',text:'Скачивание…'};return{ok:true}}}};
 chrome.storage={local:{get:async()=>({placement:'top-left',showCurrentPanel:false}),set:async value=>requests.push({settings:value})}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../popup.js'),'utf8'),{document:doc,chrome,setInterval:f=>poll=f});
 await new Promise(r=>setImmediate(r));
 assert.equal(elements.get('video-title').textContent,'Текущий VK');assert.equal(elements.get('helper').textContent,'● Помощник готов');assert.equal(elements.get('download').disabled,false);
 await elements.get('download').listeners.click();assert.equal(elements.get('download').textContent,'Отменить скачивание');
 await elements.get('download').listeners.click();assert.equal(elements.get('download').textContent,'↓ Скачать видео');
 await elements.get('folder').listeners.click();assert.equal(elements.get('folder-status').textContent,'Папка открыта в Finder.');
 elements.get('placement').value='bottom-right';elements.get('show-current-panel').checked=true;await elements.get('placement').listeners.change();assert.equal(requests.at(-1).settings.placement,'bottom-right');assert.equal(requests.at(-1).settings.showCurrentPanel,true);
 page.current=null;page.cards=5;await poll();assert.equal(elements.get('download').disabled,true);assert.ok(elements.get('page-hint').textContent.includes('5'));
});
test('logo assets are valid PNGs at every Chrome size; popup scripts parse',()=>{
 for(const n of [16,32,48,128]){const b=fs.readFileSync(require.resolve('../icons/icon'+n+'.png'));assert.equal(b.readUInt32BE(16),n);assert.equal(b.readUInt32BE(20),n);}
 new vm.Script(fs.readFileSync(require.resolve('../popup.js'),'utf8'));
 const html=fs.readFileSync(require.resolve('../popup.html'),'utf8');assert.ok(html.includes('src="popup.js"'));assert.ok(!/<script(?![^>]*\bsrc=)/.test(html));
});
test('native protocol and helper commands',()=>{require('node:child_process').execFileSync('python3',[require.resolve('./native_test.py')],{stdio:'pipe'});});
test('generic cards work on an arbitrary host without a per-site selector',()=>{
 const image={alt:'Generic video'},card={tagName:'ARTICLE',parentElement:{tagName:'BODY'},querySelector:()=>image,getBoundingClientRect:()=>({width:320,height:200})};
 const anchor={href:'https://example.com/video/42',title:'Независимый ролик',getClientRects:()=>[{}],closest:()=>null,parentElement:card};card.querySelectorAll=()=>[anchor];
 const doc={querySelectorAll:s=>s==='a[href]'?[anchor]:[]};
 const result=YVD.genericCards(doc);assert.equal(result.length,1);assert.equal(result[0].element,card);assert.equal(result[0].info.url,anchor.href);
 card.querySelectorAll=()=>[anchor,{href:'https://example.com/video/43'}];assert.equal(YVD.genericCards(doc).length,0);
});
test('generic current video supports Mail, OK, direct HTML5 media and rejects local targets',()=>{
 const doc={title:'Любой сайт',querySelector:()=>null};
 for(const url of ['https://my.mail.ru/mail/person/video/_myvideo/26.html','https://ok.ru/video/222405395773','https://example.com/video/1'])assert.equal(YVD.currentVideo(doc,url).url,url);
 const media={currentSrc:'https://cdn.example.com/clip.mp4'};
 assert.equal(YVD.currentVideo({title:'HTML5',querySelector:s=>s==='video'?media:null},'https://example.com/article').url,'https://example.com/article');
 for(const url of ['file:///tmp/a','https://u:p@example.com/video/1','http://127.0.0.1/video/1','http://192.168.1.1/clip.mp4'])assert.equal(YVD.publicURL(url),null);
});
test('floating current panel is off by default while popup still receives current video',async()=>{
 const body=new El('body'),doc={body,title:'Current',createElement:tag=>new El(tag),getElementById:id=>findUI(body,id),querySelector:()=>null,querySelectorAll:()=>[]};let listener;
 const chrome={runtime:{id:'self',getURL:p=>'chrome-extension://self/'+p,onMessage:{addListener:f=>listener=f},sendMessage:async()=>[]}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),{document:doc,location:{href:vk},chrome,YVD,Element:El,Map,JSON,MutationObserver:class{observe(){}},window:{addEventListener(){}},setInterval(){},setTimeout,clearTimeout});await Promise.resolve();
 assert.equal(doc.getElementById('yvd-current'),undefined);let reply;
 listener({type:'yvd-page-info'},{id:'self',url:chrome.runtime.getURL('popup.html')},r=>reply=r);assert.equal(reply.current.url,vk);
});
test('generic detection skips off-screen cards, navigation and current-video links',()=>{
 const card={tagName:'ARTICLE',parentElement:{tagName:'BODY'},querySelector:()=>({alt:'thumb'}),getBoundingClientRect:()=>({width:320,height:200})};
 const a={href:'https://example.com/video/42',title:'Video',textContent:'Video',getClientRects:()=>[{}],getBoundingClientRect:()=>({top:4000,bottom:4200}),closest:()=>null,parentElement:card};card.querySelectorAll=()=>[a];
 const doc={URL:'https://example.com/video/1',querySelectorAll:s=>s==='a[href]'?[a]:[]};
 assert.equal(YVD.genericCards(doc).length,0);
 a.getBoundingClientRect=()=>({top:0,bottom:200});a.href=doc.URL;assert.equal(YVD.genericCards(doc).length,0);
 a.href='https://example.com/video/42';a.textContent='Войти';assert.equal(YVD.genericCards(doc).length,0);
 a.textContent='Video';a.closest=()=>({tagName:'NAV'});assert.equal(YVD.genericCards(doc).length,0);
});

test('explicit search source supports legacy Mail and arbitrary publisher paths without selecting channel links',()=>{
 for(const url of ['http://video.mail.ru/mail/vitalik_67_2010/_myvideo/49.html','https://publisher.example/articles/42.html']){
  const card={querySelector:s=>s==='a.VideoHostExtended-Host[href]'?{href:url}:{textContent:'Source title'},querySelectorAll:()=>[{href:'https://yandex.ru/video/search?text=channel'}]};
  assert.deepEqual(YVD.extract(card),{url,title:'Source title'});
 }
 const bad={querySelector:s=>s==='a.VideoHostExtended-Host[href]'?{href:'http://localhost/private'}:{textContent:'x'},querySelectorAll:()=>[]};
 assert.equal(YVD.extract(bad),null);
});

test('overlay clears before route rescan and hides cards covered by a player at the same URL',()=>{
 const body=new El('body'),loc={href:vk},events={},timers=[];let tick,mutation,covered=false;
 const card=new El('div');card.isConnected=true;card.contains=e=>e===card;
 card.getBoundingClientRect=()=>({left:10,top:10,right:210,bottom:130,width:200,height:120});
 card.querySelectorAll=()=>[];
 const doc={body,title:'test',createElement:t=>new El(t),querySelectorAll:()=>[],querySelector:()=>null,elementsFromPoint:()=>covered?[{}]:[card]};
 const chrome={runtime:{onMessage:{addListener(){}},sendMessage:async()=>[]}};
 const shared={...YVD,genericCards:()=>[{element:card,info:{url:'https://ok.ru/video/99',title:'Card'}}]};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),{document:doc,location:loc,chrome,YVD:shared,innerWidth:1000,innerHeight:800,MutationObserver:class{constructor(f){mutation=f}observe(){}},window:{addEventListener:(k,f)=>events[k]=f},setTimeout:f=>{timers.push(f);return timers.length},clearTimeout(){},setInterval:f=>tick=f});
 assert.equal(cardControls(body).length,1);assert.equal(cardControls(body)[0].style.display,'flex');
 covered=true;tick();assert.equal(cardControls(body)[0].style.display,'none');
 covered=false;tick();assert.equal(cardControls(body)[0].style.display,'flex');
 loc.href='https://vkvideo.ru/video-123_456';tick();assert.equal(cardControls(body).length,0);
 timers.shift()();assert.equal(cardControls(body).length,1);
 card.isConnected=false;mutation();assert.equal(cardControls(body).length,0);
 card.isConnected=true;timers.shift()();assert.equal(cardControls(body).length,1);
 events.pagehide();assert.equal(cardControls(body).length,0);
 events.pageshow();timers.shift()();assert.equal(cardControls(body).length,1);
});

test('version checks compare numeric components, cache safely, reject invalid metadata and restrict popup caller',async()=>{
 const {newer}=require('../updates.js');assert.ok(newer('2.10.0','2.9.0'));assert.ok(!newer('2.1','2.1.0'));assert.ok(!newer('<script>','2.0'));assert.ok(!newer('1.9','2.0'));
 const id='update-test',calls=[],messages=event(),alarms=event();let saved,body='{"version":"2.10.0","download":"https://evil.example/"}',fail=false;
 const chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,getManifest:()=>({version:'2.1.0'}),onMessage:messages},storage:{local:{get:async()=>({updateCheck:saved}),set:async x=>saved=x.updateCheck}},alarms:{onAlarm:alarms,get:async()=>null,create:async(...args)=>calls.push({alarm:args})}};
 const fetch=async(url,opts)=>{calls.push({url,opts});if(fail)throw Error('offline');return {ok:true,text:async()=>body}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../updates.js'),'utf8'),{chrome,fetch,AbortSignal,Date,JSON,module:{exports:{}}});
 await new Promise(r=>setImmediate(r));assert.equal(saved.latest,'2.10.0');assert.equal(calls.filter(x=>x.url).length,1);
 const listener=messages.listeners[0];let reply;
 assert.equal(listener({type:'yvd-check-update'},{id,url:'https://example.com/'},r=>reply=r),undefined);
 const popup={id,url:chrome.runtime.getURL('popup.html')};
 listener({type:'yvd-check-update'},popup,r=>reply=r);await new Promise(r=>setImmediate(r));assert.equal(calls.filter(x=>x.url).length,1);assert.ok(reply.available);assert.equal(reply.archive,'https://github.com/ikulichkov/yandex-video-downloader/archive/refs/heads/main.zip');
 body='{"version":"not-a-version"}';listener({type:'yvd-check-update',force:true},popup,r=>reply=r);await new Promise(r=>setImmediate(r));assert.equal(reply.status,'error');assert.equal(reply.latest,'2.10.0');
 fail=true;listener({type:'yvd-check-update',force:true},popup,r=>reply=r);await new Promise(r=>setImmediate(r));assert.equal(reply.status,'error');assert.ok(reply.available);
 for(const c of calls.filter(x=>x.url)){assert.equal(c.url,'https://raw.githubusercontent.com/ikulichkov/yandex-video-downloader/main/manifest.json');assert.equal(c.opts.credentials,'omit');assert.equal(c.opts.redirect,'error');}
 assert.equal(calls.find(x=>x.alarm).alarm[1].periodInMinutes,360);
});

test('popup offers update archive and persists user quality',async()=>{
 const elements=new Map(),requests=[];
 for(const id of ['video-title','download','status','page-hint','helper','check-helper','folder','folder-status','version','placement','show-current-panel','settings-status','quality','helper-hint','update-status','check-update','download-update'])elements.set(id,new El('div'));
 const chrome={runtime:{getManifest:()=>({version:'2.1.0'}),sendMessage:async m=>{requests.push(m);return m.type==='yvd-check-update'?{status:'ok',available:true,current:'2.1.0',latest:'2.2.0',archive:'https://evil.example/'}:{status:'ready',version:'2.2.1'}}},tabs:{query:async()=>[],sendMessage:async()=>null},storage:{local:{get:async()=>({placement:'top-left',showCurrentPanel:false,quality:'720'}),set:async m=>requests.push(m)}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../popup.js'),'utf8'),{document:{getElementById:id=>elements.get(id)},chrome,setInterval(){}});
 await new Promise(r=>setImmediate(r));assert.equal(elements.get('quality').value,'720');assert.ok(elements.get('helper-hint').textContent.includes('2.2.1'));assert.ok(elements.get('helper-hint').textContent.includes('install-windows.cmd'));assert.equal(elements.get('download-update').hidden,false);assert.equal(elements.get('download-update').href,'https://github.com/ikulichkov/yandex-video-downloader/archive/refs/heads/main.zip');
 elements.get('quality').value='best';await elements.get('quality').listeners.change();assert.equal(requests.at(-1).quality,'best');
 await elements.get('check-update').listeners.click();assert.equal(requests.at(-1).force,true);
});

test('download manager controls jobs across tabs, preserves downloads after tab close, gates history deletion',async()=>{
 const id='manager',ports=[],native=[],saved=[];
 const chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,onMessage:event(),lastError:null,sendNativeMessage:async(h,m)=>{native.push(m);return{status:'done'}},connectNative(){const p={onMessage:event(),onDisconnect:event(),sent:[],postMessage(m){this.sent.push(m)},disconnect(){}};ports.push(p);return p}},tabs:{onRemoved:event(),sendMessage:async()=>{}},storage:{local:{get:async()=>({}),set:async x=>saved.push(x)}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),{chrome,URL,YVD,Map,Date,importScripts(){}});
 const listener=chrome.runtime.onMessage.listeners[0],popup={id,url:chrome.runtime.getURL('popup.html')},page={id,url:vk,tab:{id:4}};
 const call=(m,sender=popup)=>new Promise(resolve=>listener(m,sender,resolve));
 let response;listener({type:'yvd-downloads'},page,r=>response=r);assert.equal(response,undefined);
 assert.ok((await call({type:'yvd-start',url:vk,title:'Title',quality:'720'},page)).ok);
 chrome.tabs.onRemoved.listeners[0](4);assert.equal(ports[0].sent.length,1);
 let jobs=await call({type:'yvd-downloads'});assert.equal(jobs[0].title,'Title');assert.equal(jobs[0].quality,'720');
 assert.ok((await call({type:'yvd-remove-job',url:vk})).error);
 await call({type:'yvd-cancel-job',url:vk});assert.equal(ports[0].sent.at(-1).action,'cancel');
 ports[0].onMessage.listeners[0]({status:'cancelled'});await call({type:'yvd-retry-job',url:vk});assert.equal(ports[1].sent[0].quality,'720');
 ports[1].onMessage.listeners[0]({status:'done',filename:'/fixed/download/video.mp4'});
 await call({type:'yvd-remove-job',url:vk,trashFile:true});assert.equal(native[0].action,'trash-file');assert.equal(native[0].filename,'/fixed/download/video.mp4');
 assert.equal((await call({type:'yvd-downloads'})).length,0);assert.ok(saved.length);
});

test('persisted active downloads become interrupted rather than claiming to run after worker restart',async()=>{
 const id='restore',chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,onMessage:event()},tabs:{onRemoved:event()},storage:{local:{get:async()=>({downloadHistory:[{url:vk,title:'Restored',status:'progress'}]})}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),{chrome,URL,YVD,Map,Date,importScripts(){}});
 const jobs=await new Promise(resolve=>chrome.runtime.onMessage.listeners[0]({type:'yvd-downloads'},{id,url:chrome.runtime.getURL('popup.html')},resolve));
 assert.equal(jobs[0].status,'error');assert.ok(jobs[0].text.includes('перезапуском'));
});

test('downloaded memory survives restart/new tabs and history removal; trash clears the mark',async()=>{
 const id='memory';let saved={downloadHistory:[{url:vk,title:'Saved',status:'done',filename:'/fixed/video.mp4'}]};
 function boot(){
  const chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,onMessage:event(),sendNativeMessage:async()=>({status:'done'})},tabs:{onRemoved:event()},storage:{local:{get:async()=>JSON.parse(JSON.stringify(saved)),set:async x=>saved={...saved,...JSON.parse(JSON.stringify(x))}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),{chrome,YVD,Map,Date,importScripts(){}});
  return (msg,popup=false)=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0](msg,popup?{id,url:chrome.runtime.getURL('popup.html')}:{id,url:'https://yandex.ru/video/search?text=test',tab:{id:99}},resolve));
 }
 let call=boot();let states=await call({type:'yvd-status'});assert.equal(states[0].downloaded,true);
 await call({type:'yvd-remove-job',url:vk},true);assert.equal((await call({type:'yvd-status'}))[0].downloaded,true);
 call=boot();states=await call({type:'yvd-status'});assert.equal(states[0].url,vk);assert.equal(states[0].downloaded,true);
 saved.downloadHistory=[{url:vk,title:'Saved',status:'done',filename:'/fixed/video.mp4'}];call=boot();
 await call({type:'yvd-remove-job',url:vk,trashFile:true},true);assert.equal((await call({type:'yvd-status'})).length,0);
 call=boot();assert.equal((await call({type:'yvd-status'})).length,0);
});

test('saved card has a compact green check and still permits another download',async()=>{
 const body=new El('body'),requests=[],url='https://ok.ru/video/99';let receive,storageChanged,list=[{url,status:'done',downloaded:true}];
 const card=new El('div');card.querySelectorAll=()=>[];
 const doc={body,title:'test',createElement:t=>new El(t),querySelectorAll:()=>[],querySelector:()=>null};
 const chrome={runtime:{onMessage:{addListener:f=>receive=f},sendMessage:async m=>{requests.push(m);return m.type==='yvd-status'?list:{ok:true}}},storage:{local:{get:async()=>({placement:'top-left',showCurrentPanel:false})},onChanged:{addListener:f=>storageChanged=f}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),{document:doc,location:{href:vk},chrome,YVD:{...YVD,genericCards:()=>[{element:card,info:{url,title:'Saved card'}}]},Map,JSON,MutationObserver:class{observe(){}},window:{addEventListener(){}},setInterval(){},setTimeout,clearTimeout});
 await new Promise(r=>setImmediate(r));let button=cardControls(body)[0].children.find(x=>x.tag==='button');assert.equal(button.textContent,'✓');assert.equal(button.className,'downloaded');assert.ok(button.attrs['aria-label'].includes('Скачать ещё'));
 await button.listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).type,'yvd-start');
 list=[];storageChanged({downloadedVideos:{newValue:[]}},'local');await new Promise(r=>setImmediate(r));button=cardControls(body)[0].children.find(x=>x.tag==='button');assert.equal(button.textContent,'↓');assert.notEqual(button.className,'downloaded');
});

test('ad-first players never select ad src as current content; explicitly marked ad cards are excluded',()=>{
 const ad={currentSrc:'https://cdn.example/advert.mp4',closest:()=>({})};
 const main={currentSrc:'https://cdn.example/main.mp4',closest:()=>null};
 const page='https://publisher.example/articles/42';
 const doc={title:'Main content',querySelector:()=>null,querySelectorAll:s=>s==='video'?[ad,main]:[]};
 assert.equal(YVD.currentVideo(doc,page).url,page);
 main.currentSrc='https://cdn.example/preroll.mp4';assert.equal(YVD.currentVideo(doc,page).url,page);
 doc.querySelectorAll=s=>s==='video'?[ad]:[];assert.equal(YVD.currentVideo(doc,page),null);
 assert.equal(YVD.isAd({name:'google_ads_iframe_42',closest:()=>null}),true);
 assert.equal(YVD.extract({closest:()=>({}),querySelector:()=>{throw Error('must not extract ad')}}),null);
 const anchor={href:'https://publisher.example/video/42',closest:()=>({}),getClientRects:()=>[{}]};
 assert.equal(YVD.genericCards({querySelectorAll:s=>s==='a[href]'?[anchor]:[]}).length,0);
});

test('concurrency defaults to five; saved/live limits gate starts atomically without stopping existing jobs',async()=>{
 function boot(value,delayed=false){
  let hydrate;const ports=[],changes=event(),chrome={runtime:{id:'limit',getURL:p=>'chrome-extension://limit/'+p,onMessage:event(),connectNative(){const p={onMessage:event(),onDisconnect:event(),sent:[],postMessage(m){this.sent.push(m)},disconnect(){}};ports.push(p);return p}},tabs:{onRemoved:event(),sendMessage:async()=>{}},storage:{onChanged:changes,local:{get:()=>delayed?new Promise(r=>hydrate=r):Promise.resolve({maxConcurrentDownloads:value}),set:async()=>{}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),{chrome,YVD,Map,Date,importScripts(){}});
  const start=n=>new Promise(resolve=>{assert.equal(chrome.runtime.onMessage.listeners[0]({type:'yvd-start',url:'https://example.com/video/'+n},{id:'limit',url:vk,tab:{id:n}},resolve),true)});
  return {ports,start,change:v=>changes.listeners[0]({maxConcurrentDownloads:{newValue:v}},'local'),hydrate:()=>hydrate({maxConcurrentDownloads:value})};
 }
 let h=boot(undefined);const replies=await Promise.all(Array.from({length:6},(_,n)=>h.start(n)));
 assert.equal(replies.filter(x=>x.ok).length,5);assert.ok(replies[5].error.includes('(5)'));assert.equal(h.ports.length,5);
 h.change(1);assert.ok((await h.start(7)).error.includes('(1)'));assert.equal(h.ports.flatMap(p=>p.sent).filter(x=>x.action==='cancel').length,0);
 h.change(6);assert.ok((await h.start(7)).ok);assert.equal(h.ports.length,6);
 h=boot(2,true);const pending=h.start(1);assert.equal(h.ports.length,0);h.hydrate();assert.ok((await pending).ok);assert.ok((await h.start(2)).ok);assert.ok((await h.start(3)).error.includes('(2)'));
 h=boot(1,true);h.change(3);h.hydrate();assert.ok((await h.start(1)).ok);assert.ok((await h.start(2)).ok);assert.ok((await h.start(3)).ok);assert.ok((await h.start(4)).error.includes('(3)'));
 h=boot(-9);for(let n=0;n<5;n++)assert.ok((await h.start(n)).ok);assert.ok((await h.start(8)).error.includes('(5)'));
});

test('popup loads default-five concurrency and saves only valid whole values',async()=>{
 const elements=new Map(),writes=[];
 for(const id of ['video-title','download','status','page-hint','helper','check-helper','folder','folder-status','version','max-concurrent-downloads','concurrency-status'])elements.set(id,new El('div'));
 const chrome={runtime:{getManifest:()=>({version:'2.2.5'}),sendMessage:async()=>({status:'ready'})},tabs:{query:async()=>[]},storage:{local:{get:async defaults=>defaults,set:async v=>writes.push(v)}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../popup.js'),'utf8'),{document:{getElementById:id=>elements.get(id)},chrome,setInterval(){}});
 await new Promise(r=>setImmediate(r));const input=elements.get('max-concurrent-downloads');assert.equal(Number(input.value),5);
 for(const bad of ['',0,21,2.5,'abc']){input.value=bad;await input.listeners.change();assert.equal(writes.length,0);assert.equal(input.attrs['aria-invalid'],'true');}
 input.value='7';await input.listeners.change();assert.equal(writes[0].maxConcurrentDownloads,7);assert.equal(input.attrs['aria-invalid'],'false');
});

test('open/reveal job actions are popup-only and use saved output path, never caller input',async()=>{
 const id='file-actions',calls=[],chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,onMessage:event(),sendNativeMessage:async(h,msg)=>{calls.push(msg);return{status:'done'}}},tabs:{onRemoved:event()},storage:{local:{get:async()=>({downloadHistory:[{url:vk,title:'Saved',status:'done',filename:'/fixed/video.mp4'}]})}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),{chrome,YVD,Map,Date,importScripts(){}});
 const listener=chrome.runtime.onMessage.listeners[0];let response;
 listener({type:'yvd-open-job',url:vk},{id,url:vk,tab:{id:1}},r=>response=r);assert.equal(response,undefined);assert.equal(calls.length,0);
 const send=type=>new Promise(resolve=>listener({type,url:vk,filename:'/etc/passwords'},{id,url:chrome.runtime.getURL('popup.html')},resolve));
 assert.ok((await send('yvd-open-job')).ok);assert.equal(calls[0].action,'open-file');assert.equal(calls[0].filename,'/fixed/video.mp4');
 assert.ok((await send('yvd-reveal-job')).ok);assert.equal(calls[1].action,'reveal-file');
});

test('Yandex Music uses exact row/player links and album control, rejects wrong hosts',()=>{
 const M=require('../music.js'),a=href=>({getAttribute:k=>k==='href'?href:null,textContent:'Трек'});
 const row={querySelectorAll:()=>[a('/album/1750287/track/15608804')]};
 const player={querySelectorAll:()=>[a('/album/1750287/track/15495541')]},header={};
 const doc={querySelector:()=>({textContent:'Apero Lounge'}),querySelectorAll:s=>s.includes('CommonTrack_root')?[row]:s.includes('PageHeaderBase_controls')?[header]:[player]};
 const controls=M.controls(doc,'https://music.yandex.ru/album/1750287');
 assert.equal(controls.length,3);assert.equal(controls[0].info.url,'https://music.yandex.ru/album/1750287/track/15608804');
 assert.equal(controls[1].info.url,'https://music.yandex.ru/album/1750287/track/15495541');assert.equal(controls[2].info.media,'album');
 assert.equal(M.current(doc,'https://music.yandex.ru/').url,controls[1].info.url);
 for(const bad of ['https://music.yandex.ru.evil/album/1','https://u:p@music.yandex.ru/album/1','https://music.yandex.ru:12/album/1','file:///album/1'])assert.equal(M.url(bad),null);
 assert.equal(M.controls(doc,'https://example.com/album/1750287').length,0);
});

test('music row download/stop and album progress use existing isolated controls',async()=>{
 const body=new El('body'),row=new El('div'),requests=[];let receive;
 row.getBoundingClientRect=()=>({left:110,top:220,right:820,bottom:276,width:710,height:56});row.querySelectorAll=()=>[];
 const info={url:'https://music.yandex.ru/album/1750287',title:'Album',media:'album',musicPosition:'album'};
 const doc={body,title:'Music',createElement:t=>new El(t),querySelectorAll:()=>[],querySelector:()=>null};
 const chrome={runtime:{onMessage:{addListener:f=>receive=f},sendMessage:async m=>{requests.push(m);return m.type==='yvd-status'?[]:{ok:true}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),{document:doc,chrome,location:{href:info.url},window:{addEventListener(){}},MutationObserver:class{observe(){}},setTimeout(){},setInterval(){},YVD:{genericCards:()=>[],currentVideo:()=>null},YVM:{controls:()=>[{element:row,info}],current:()=>null}});
 const ui=body.children[0].shadowRoot.children.find(e=>e.dataset.signature);
 assert.equal(ui.children[0].textContent,'↓ Скачать альбом');await ui.children[0].listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).url,info.url);
 receive({type:'yvd-state',url:info.url,status:'progress',percent:40,text:'Сохранено 2 из 5'});
 assert.equal(ui.children[0].textContent,'■ Остановить альбом 40%');await ui.children[0].listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).type,'yvd-cancel');assert.equal(row.children.length,0);
});

test('album completions persist individual tracks with file actions; cancellation keeps saved children',async()=>{
 const ports=[],id='music-history',saved={};const chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,onMessage:event(),connectNative(){const p={onMessage:event(),onDisconnect:event(),sent:[],postMessage(m){this.sent.push(m)},disconnect(){}};ports.push(p);return p}},tabs:{onRemoved:event(),sendMessage:async()=>{}},storage:{local:{get:async()=>({}),set:async x=>Object.assign(saved,x)}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),{chrome,YVD,Map,Date,importScripts(){}});
 const listener=chrome.runtime.onMessage.listeners[0],album='https://music.yandex.ru/album/1',track=album+'/track/2';
 const send=(msg,popup=false)=>new Promise(resolve=>listener(msg,popup?{id,url:chrome.runtime.getURL('popup.html')}:{id,url:album,tab:{id:1}},resolve));
 assert.ok((await send({type:'yvd-start',url:album})).ok);
 ports[0].onMessage.listeners[0]({status:'progress',completedUrl:track,completedTitle:'Artist — Track',completedFilename:'/fixed/track.mp3'});
 let list=await send({type:'yvd-downloads'},true);assert.equal(list.find(j=>j.url===track).filename,'/fixed/track.mp3');assert.equal(list.find(j=>j.url===track).status,'done');
 await send({type:'yvd-cancel',url:album});assert.equal(ports[0].sent.at(-1).action,'cancel');ports[0].onMessage.listeners[0]({status:'cancelled'});
 list=await send({type:'yvd-downloads'},true);assert.equal(list.find(j=>j.url===track).status,'done');assert.equal(list.find(j=>j.url===album).status,'cancelled');
 assert.equal((await send({type:'yvd-status'})).find(j=>j.url===track).downloaded,true);
});
