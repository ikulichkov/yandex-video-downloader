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
 assert.equal(YVD.currentVideo(doc,'https://ya.ru.evil.test/video/preview/1'),null);
});
test('VK uses current URL, ignores recommendation links, leaves non-video routes',()=>{
 const doc={title:'VK current',querySelector:()=>null,querySelectorAll:()=>{throw Error('must not inspect recommendations')}};
 assert.deepEqual(YVD.currentVideo(doc,vk),{url:vk,title:'VK current'});
 assert.equal(YVD.currentVideo(doc,'https://vkvideo.ru/'),null);
 assert.equal(YVD.currentVideo(doc,'https://vkvideo.ru/video-123_456').url,'https://vkvideo.ru/video-123_456');
 assert.equal(YVD.currentVideo(doc,'https://vkvideo.ru.evil.test/video-123_456'),null);
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
 function send(type,url,senderURL=vk){let reply;listener({type,url},{tab:{id:1},url:senderURL},x=>reply=x);return reply;}
 assert.equal(send('yvd-start',vk,'https://evil.test/video-123_456'),undefined);
 assert.equal(send('yvd-start',vk,'https://vkvideo.ru/'),undefined);
 assert.equal(ports.length,0);
 assert.ok(send('yvd-start',vk).ok);assert.equal(ports.length,1);
 assert.ok(send('yvd-start',vk).error);assert.equal(ports.length,1);
 ports[0].onMessage.listeners[0]({status:'progress',percent:50,text:'50%'});assert.equal(sent.at(-1).percent,50);
 assert.ok(send('yvd-cancel',vk).ok);assert.equal(ports[0].sent.at(-1).action,'cancel');
 ports[0].onMessage.listeners[0]({status:'done',filename:'file.mp4'});assert.equal(sent.at(-1).status,'done');
 assert.ok(send('yvd-start',dzen,'https://ya.ru/video/preview/1').ok);
});
class El{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.listeners={};this.attrs={};this.parent=null;}
 append(...items){for(const x of items){x.parent=this;this.children.push(x)}}
 replaceChildren(){this.children=[]}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(k,fn){this.listeners[k]=fn}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)}
}
test('current-video panel updates across SPA routes, sends exact URL, and removes on leaving video',async()=>{
 const body=new El('body'),requests=[],loc={href:vk};let interval,receive;
 const doc={body,title:'VK current',createElement:tag=>new El(tag),getElementById:id=>body.children.find(e=>e.id===id),querySelector:()=>null,querySelectorAll:()=>[]};
 const chrome={runtime:{onMessage:{addListener:f=>receive=f},sendMessage:async m=>{requests.push(m);return m.type==='yvd-status'?[]:{ok:true}}}};
 const context={document:doc,location:loc,chrome,YVD,Element:El,Map,JSON,MutationObserver:class{observe(){}},window:{addEventListener(){}},setInterval:f=>interval=f,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),context);
 await Promise.resolve();
 let panel=doc.getElementById('yvd-current');assert.ok(panel);assert.equal(body.children.length,1);
 let button=panel.children.find(x=>x.tag==='button');assert.equal(button.textContent,'↓ Скачать текущее видео');
 await button.listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).url,vk);
 receive({type:'yvd-state',url:vk,status:'progress',text:'50%'});
 button=panel.children.find(x=>x.tag==='button');assert.equal(button.textContent,'Отменить');
 await button.listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).type,'yvd-cancel');
 loc.href='https://vkvideo.ru/video-123_456';interval();panel=doc.getElementById('yvd-current');assert.equal(body.children.length,1);
 button=panel.children.find(x=>x.tag==='button');await button.listeners.click({preventDefault(){},stopPropagation(){}});assert.equal(requests.at(-1).url,loc.href);
 loc.href='https://vkvideo.ru/';interval();assert.equal(doc.getElementById('yvd-current'),undefined);
});
test('manifest identity retained; code parses; exact requested video pages covered',()=>{
 const manifest=JSON.parse(fs.readFileSync(require.resolve('../manifest.json'),'utf8'));
 const crypto=require('node:crypto'),hex=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32);
 assert.equal([...hex].map(x=>String.fromCharCode(97+parseInt(x,16))).join(''),'hdokhbookocbnojobgeihfenlfgkfchh');
 assert.deepEqual(manifest.permissions,['nativeMessaging']);
 assert.ok(manifest.content_scripts[0].matches.includes('https://vkvideo.ru/*'));
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
 const doc={body,title:'Основной ролик',createElement:tag=>new El(tag),getElementById:id=>body.children.find(e=>e.id===id),querySelector:()=>null,querySelectorAll:s=>{assert.ok(s.includes('video_card_layout'));return cards}};
 const chrome={runtime:{onMessage:{addListener:f=>receive=f},sendMessage:async m=>{requests.push(m);return m.type==='yvd-status'?[]:{ok:true}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),{document:doc,location:loc,chrome,YVD,Element:El,Map,JSON,MutationObserver:class{constructor(f){changed=f}observe(){}},window:{addEventListener(){}},setInterval(){},setTimeout(f){f();return 0},clearTimeout(){}});
 await Promise.resolve();
 assert.equal(first.card.children.filter(x=>x.className==='yvd-tools').length,1);
 let ui=first.card.children.find(x=>x.className==='yvd-tools'),button=ui.children.find(x=>x.tag==='button');
 await button.listeners.click({preventDefault(){},stopPropagation(){}});
 assert.equal(requests.at(-1).url,first.card.url);assert.equal(loc.href,vk);
 receive({type:'yvd-state',url:first.card.url,status:'progress',text:'50%'});
 assert.equal(first.card.children.filter(x=>x.className==='yvd-tools').length,1);assert.equal(first.card.children.find(x=>x.className==='yvd-tools').children.find(x=>x.tag==='button').textContent,'Отменить');
 const second=makeCard('https://vkvideo.ru/video-123_999','Подгруженный ролик');cards.push(second.card);changed([{target:{}}]);
 assert.equal(first.card.children.filter(x=>x.className==='yvd-tools').length,1);assert.equal(second.card.children.filter(x=>x.className==='yvd-tools').length,1);
 button=second.card.children.find(x=>x.className==='yvd-tools').children.find(x=>x.tag==='button');await button.listeners.click({preventDefault(){},stopPropagation(){}});
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
 for(const id of ['video-title','download','status','page-hint','helper','check-helper','folder','folder-status','version'])elements.set(id,new El('div'));
 const doc={getElementById:id=>elements.get(id)},page={supported:true,current:{url:vk,title:'Текущий VK'},state:null};
 const chrome={runtime:{getManifest:()=>({version:'1.2.0'}),sendMessage:async msg=>{requests.push(msg);return {status:msg.type==='yvd-helper-status'?'ready':'done'}}},tabs:{query:async q=>{assert.deepEqual(JSON.parse(JSON.stringify(q)),{active:true,currentWindow:true});return[{id:9}]},sendMessage:async(id,msg)=>{assert.equal(id,9);requests.push(msg);if(msg.type==='yvd-page-info')return page;page.state={status:page.state?'cancelled':'progress',text:'Скачивание…'};return{ok:true}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../popup.js'),'utf8'),{document:doc,chrome,setInterval:f=>poll=f});
 await new Promise(r=>setImmediate(r));
 assert.equal(elements.get('video-title').textContent,'Текущий VK');assert.equal(elements.get('helper').textContent,'● Помощник готов');assert.equal(elements.get('download').disabled,false);
 await elements.get('download').listeners.click();assert.equal(elements.get('download').textContent,'Отменить скачивание');
 await elements.get('download').listeners.click();assert.equal(elements.get('download').textContent,'↓ Скачать видео');
 await elements.get('folder').listeners.click();assert.equal(elements.get('folder-status').textContent,'Папка открыта в Finder.');
 page.current=null;page.cards=5;await poll();assert.equal(elements.get('download').disabled,true);assert.ok(elements.get('page-hint').textContent.includes('5'));
});
test('logo assets are valid PNGs at every Chrome size; popup scripts parse',()=>{
 for(const n of [16,32,48,128]){const b=fs.readFileSync(require.resolve('../icons/icon'+n+'.png'));assert.equal(b.readUInt32BE(16),n);assert.equal(b.readUInt32BE(20),n);}
 new vm.Script(fs.readFileSync(require.resolve('../popup.js'),'utf8'));
 const html=fs.readFileSync(require.resolve('../popup.html'),'utf8');assert.ok(html.includes('src="popup.js"'));assert.ok(!/<script(?![^>]*\bsrc=)/.test(html));
});
test('native protocol and helper commands',()=>{require('node:child_process').execFileSync('python3',[require.resolve('./native_test.py')],{stdio:'pipe'});});
