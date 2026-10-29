/* Shared pure card extraction: never use video.src (Yandex thumbnail previews). */
(function (root) {
  const hosts = new Set(['dzen.ru','rutube.ru','ok.ru','vk.com','vkvideo.ru','youtube.com','www.youtube.com','m.youtube.com','youtu.be']);
  function isYouTubePage(value){try{const h=new URL(value).hostname.toLowerCase().replace(/\.$/,'');return h==='youtube.com'||h.endsWith('.youtube.com')||h==='youtu.be'||h.endsWith('.youtu.be');}catch{return false;}}
  function sourceURL(value) {
    try {
      const u = new URL(value);
      if(!['https:','http:'].includes(u.protocol) || u.username || u.password || u.port || !hosts.has(u.hostname)) return null;
      const h = u.hostname, p = u.pathname;
      const valid = h==='dzen.ru' ? /^\/video\/watch\/[a-f\d]+\/?$/i.test(p)
        : h==='rutube.ru' ? /^\/video\/[a-f\d]{32}\/?$/i.test(p)
        : h==='ok.ru' ? /^\/video\/\d+\/?$/.test(p)
        : h==='vk.com'||h==='vkvideo.ru' ? /^\/video-?\d+_\d+\/?$/.test(p)
        : h==='youtu.be' ? /^\/[\w-]{11}\/?$/.test(p)
        : p==='/watch' ? /^[\w-]{11}$/.test(u.searchParams.get('v')||'')
        : /^\/(shorts|embed)\/[\w-]{11}\/?$/.test(p);
      u.protocol='https:';
      return valid ? u.href : null;
    } catch { return null; }
  }
  function extract(card) {
    if(isAd(card))return null;
    let fallback=null;
    const title=a=>(card.querySelector('.VideoSnippet-Title, .VideoViewer-DetailsTitle, [data-testid="video_card_title"]')?.textContent||a.title||'Видео').trim().slice(0,200);
    // The search result explicitly identifies its original source. Its URL need
    // not contain /video/ (legacy Mail and arbitrary publisher routes do not).
    const source=card.querySelector('a.VideoHostExtended-Host[href]');
    const explicit=source&&publicURL(source.href);
    if(explicit)return {url:sourceURL(explicit)||explicit,title:title(source)};
    for(const a of card.querySelectorAll('a[href]')){
      const url=sourceURL(a.href);if(url)return {url,title:title(a)};
      const generic=videoURL(a.href);
      if(generic){const host=new URL(generic).hostname;if(host!=='ya.ru'&&host!=='yandex.ru'&&!host.endsWith('.yandex.ru'))fallback ||= {url:generic,title:title(a)};}
    }
    return fallback;
  }
  function publicURL(value) {
    try {
      const u=new URL(value);
      if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!u.hostname) return null;
      const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
      if(host==='localhost'||/\.(local|localhost|internal|invalid)$/.test(host)||/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)||host==='::1'||host==='0.0.0.0')return null;
      return u.href;
    }catch{return null;}
  }
  function videoURL(value) {
    const url=publicURL(value);if(!url)return null;
    const u=new URL(url);
    if(/^\/(?:video|videos)\/(?:search|trends|feed|catalog)\/?$/.test(u.pathname))return null;
    if(/\.(mp4|webm|mov|m4v|m3u8|mpd)(?:$|[?#])/i.test(url))return url;
    return sourceURL(url)||((/\/(?:video(?:embed)?|videos|watch|clip|clips|movie|embed|player)(?:\/|-)[^/?#]+/i.test(u.pathname)||/\/(?:watch|player)$/.test(u.pathname)&&/[?&](?:v|video|clip|movie|id)=/.test(u.search))?url:null);
  }
  function pageTitle(doc){return (doc.querySelector?.('meta[property="og:title"]')?.content||doc.title||'Видео').slice(0,200);}
  function isAd(element){
    if(!element)return false;
    return Boolean(element.closest?.('[data-ad="true"],[data-is-ad="true"],[itemprop="advertisement"],[aria-label="Advertisement" i],[aria-label="Реклама" i]'))||/^(google_ads_iframe|aswift_)/i.test(String(element.name||element.id||''));
  }
  function currentVideo(doc, pageURL) {
    let page;try{page=new URL(pageURL);}catch{return null;}
    if((page.hostname==='ya.ru'||page.hostname==='yandex.ru'||page.hostname.endsWith('.yandex.ru'))&&/^\/video\/preview\/\d+/.test(page.pathname)){
      for(const details of doc.querySelectorAll('.VideoViewer-Details')){
        if(!details.getClientRects().length)continue;
        const info=extract(details);if(info)return info;
      }
      return null;
    }
    if(!publicURL(pageURL))return null;
    if(videoURL(pageURL)||doc.querySelector?.('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]'))return {url:page.href,title:pageTitle(doc)};
    // Search feeds on known video providers do not identify one current video.
    if(hosts.has(page.hostname)||page.hostname==='ya.ru'||page.hostname==='yandex.ru'||page.hostname.endsWith('.yandex.ru'))return null;
    const videos=doc.querySelectorAll?Array.from(doc.querySelectorAll('video')):[doc.querySelector?.('video')];
    // During client-side ads the same <video> may temporarily contain an ad URL.
    // Resolve the page's original content rather than downloading the first src.
    if(videos.some(video=>video&&!isAd(video)))return {url:page.href,title:pageTitle(doc)};
    const selector='iframe[src*="/embed/"],iframe[src*="/videoembed/"],iframe[src*="/player/"]';
    const frames=doc.querySelectorAll?Array.from(doc.querySelectorAll(selector)):[doc.querySelector?.(selector)];
    const frame=frames.find(frame=>frame&&!isAd(frame)&&videoURL(frame.src));
    if(frame&&videoURL(frame.src))return {url:videoURL(frame.src),title:pageTitle(doc)};
    return null;
  }
  function genericCards(doc) {
    const found=new Map();let checked=0;
    for(const anchor of doc.querySelectorAll('a[href]')){
      if(++checked>3000||found.size>=40)break;
      if(isAd(anchor))continue;
      const url=videoURL(anchor.href);if(!url||anchor.closest?.('.yvd-tools,.VideoSnippet,[data-testid="video_card_layout"]'))continue;
      if(!anchor.getClientRects?.().length)continue;
      if(anchor.closest?.('header,nav,form,[role="navigation"],[role="banner"]'))continue;
      if(/^(войти|войдите|зарегистр|sign in|log in|login|register)/i.test((anchor.textContent||'').trim()))continue;
      if(doc.URL){const page=new URL(doc.URL),video=new URL(url);const same=page.origin===video.origin&&page.pathname===video.pathname&&['v','id','video','clip','movie'].every(k=>page.searchParams.get(k)===video.searchParams.get(k));if(same)continue;}
      const anchorRect=anchor.getBoundingClientRect?.();
      if(anchorRect&&(anchorRect.bottom<0||anchorRect.top>(typeof innerHeight==='number'?innerHeight:2000)+100))continue;
      let node=anchor.parentElement,chosen=null;
      for(let depth=0;node&&depth<4;depth++,node=node.parentElement){
        if(['BODY','HTML'].includes(node.tagName))break;
        if(!node.querySelector('img,picture,video,canvas,[role="img"],[style*="background-image"]'))continue;
        const urls=new Set(Array.from(node.querySelectorAll('a[href]')).map(a=>videoURL(a.href)).filter(Boolean));
        const rect=node.getBoundingClientRect();
        if(urls.size!==1||rect.height>600||rect.width>1100)break;
        chosen=node;
      }
      if(chosen)found.set(chosen,{url,title:(anchor.title||anchor.textContent?.trim()||chosen.querySelector('img')?.alt||'Видео').slice(0,200)});
    }
    const videos=Array.from(doc.querySelectorAll('video')).filter(v=>v.getClientRects?.().length&&!isAd(v));
    if(videos.length>1)for(const video of videos){
      const url=publicURL(video.currentSrc||video.src);const element=video.parentElement;
      if(url&&element&&!video.closest?.('.VideoSnippet,[data-testid="video_card_layout"],a'))found.set(element,{url,title:video.title||pageTitle(doc)});
    }
    return Array.from(found,([element,info])=>({element,info}));
  }
  root.YVD = {isYouTubePage,sourceURL,extract,publicURL,videoURL,currentVideo,genericCards,isAd};
  if(typeof module !== 'undefined') module.exports=root.YVD;
})(typeof globalThis!=='undefined'?globalThis:this);
