/* Shared pure card extraction: never use video.src (Yandex thumbnail previews). */
(function (root) {
  const hosts = new Set(['dzen.ru','rutube.ru','ok.ru','vk.com','vkvideo.ru','youtube.com','www.youtube.com','m.youtube.com','youtu.be']);
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
    for (const a of card.querySelectorAll('a[href]')) {
      const url=sourceURL(a.href);
      if(url) return {url,title:(card.querySelector('.VideoSnippet-Title, .VideoViewer-DetailsTitle, [data-testid="video_card_title"]')?.textContent||a.title||'Видео').trim().slice(0,200)};
    }
    return null;
  }
  function currentVideo(doc, pageURL) {
    let page;
    try { page=new URL(pageURL); } catch { return null; }
    if (['vkvideo.ru','vk.com'].includes(page.hostname)) {
      const url=sourceURL(page.href);
      return url ? {url,title:(doc.querySelector('meta[property="og:title"]')?.content || doc.title || 'Видео').slice(0,200)} : null;
    }
    if ((page.hostname==='ya.ru'||page.hostname==='yandex.ru'||page.hostname.endsWith('.yandex.ru')) && /^\/video\/preview\/\d+/.test(page.pathname)) {
      // Scope to player details. Related cards have their own unrelated sources.
      for (const details of doc.querySelectorAll('.VideoViewer-Details')) {
        if (!details.getClientRects().length) continue;
        const info=extract(details);
        if (info) return info;
      }
    }
    return null;
  }
  root.YVD = {sourceURL,extract,currentVideo};
  if(typeof module !== 'undefined') module.exports=root.YVD;
})(typeof globalThis!=='undefined'?globalThis:this);
