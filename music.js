/* Yandex Music DOM adapter. Only public track identity, never player blobs/tokens. */
(function(scope){
  function url(value,base='https://music.yandex.ru/'){
    try{const u=new URL(value,base);if(!/^music\.yandex\.(ru|com|kz|by|ua)$/.test(u.hostname)||u.username||u.password||u.port||!/^https?:$/.test(u.protocol))return null;
      const m=u.pathname.match(/^\/album\/(\d+)(?:\/track\/(\d+))?\/?$/);return m?'https://music.yandex.ru/album/'+m[1]+(m[2]?'/track/'+m[2]:''):null;
    }catch{return null;}
  }
  const track=(e,base)=>{for(const a of e.querySelectorAll('a[href*="/track/"]')){const link=url(a.getAttribute('href'),base);if(link?.includes('/track/'))return {url:link,title:(a.getAttribute('aria-label')||a.textContent||'Трек').replace(/^Трек\s+/, '').trim().slice(0,200),media:'audio'};}return null;};
  const playerSelector='[class*="VibePlayerBar_root"],section[class*="PlayerBar_root"],section[class*="PlayerBarDesktopWithBackgroundProgressBar_root"],section[aria-label="Плеер"]';
  function playerTrack(e,base){
    const own=track(e,base);if(own)return own;
    const region=e.closest?.('[class*="VibePage_meta"]');
    if(!region)return null;
    const links=new Map();
    for(const a of region.querySelectorAll('a[href*="/track/"]')){if(a.getClientRects?.().length===0)continue;const link=url(a.getAttribute('href'),base);if(link?.includes('/track/'))links.set(link,{url:link,title:(a.getAttribute('aria-label')||a.textContent||'Трек').replace(/^Трек\s+/,'').trim().slice(0,200),media:'audio'});}
    return links.size===1?[...links.values()][0]:null;
  }
  const position=e=>String(e.className||'').includes('VibePlayerBar_root')?'wave':'player';
  function matches(e,info,doc,base){const actual=info.musicPosition==='track'?track(e,base):['player','wave'].includes(info.musicPosition)?playerTrack(e,base):{url:url(base)};return actual?.url===info.url;}
  function current(doc,base){if(!/^https?:\/\/music\.yandex\.(ru|com|kz|by|ua)(?:\/|$)/.test(base))return null;for(const e of doc.querySelectorAll(playerSelector)){if(e.getClientRects?.().length===0)continue;const info=playerTrack(e,base);if(info)return info;}return null;}
  function controls(doc,base){
    if(!/^https?:\/\/music\.yandex\.(ru|com|kz|by|ua)(?:\/|$)/.test(base))return [];
    const result=[];
    for(const e of [...doc.querySelectorAll('[class*="CommonTrack_root"]')].slice(0,500)){const info=track(e,base);if(info)result.push({element:e,info:{...info,musicPosition:'track'}});}
    for(const e of doc.querySelectorAll(playerSelector)){const info=playerTrack(e,base);if(info)result.push({element:e,info:{...info,musicPosition:position(e)}});}
    const album=url(base);
    if(album&&!album.includes('/track/'))for(const e of doc.querySelectorAll('[class*="PageHeaderBase_controls"]'))result.push({element:e,info:{url:album,title:(doc.querySelector('h1')?.textContent||'Альбом').trim().slice(0,200),media:'album',musicPosition:'album'}});
    return result;
  }
  const api={url,track,playerTrack,matches,current,controls};scope.YVM=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
