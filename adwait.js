/* Bounded deferred download. An unmarked ended/src-change is not proof of an ad. */
(function(scope){
  function isAd(video){return Boolean(video?.closest?.('.vjs-ad-playing,.vjs-ad-loading,.ad-showing,.ad-interrupting,[data-ad="true"],[data-is-ad="true"],[itemprop="advertisement"],[aria-label="Advertisement" i],[aria-label="Реклама" i]'));}
  function create(){
    let request=null,state='idle',sawAd=false,stableAt=null,mediaAt=null,lastMedia='',phase='source',adSources=new Set();
    const view=()=>({state,sawAd,phase});
    function reset(){stableAt=null;mediaAt=null;lastMedia='';}
    function cancel(reason='cancelled'){request=null;state=reason;reset();return view();}
    function arm(context,now){request={...context,armedAt:now};state='waiting';sawAd=false;phase='source';adSources.clear();reset();return view();}
    function start(mediaUrl){if(state!=='waiting'||!request)return null;const value={...request,...(mediaUrl?{mediaUrl}:{})};request=null;state='started';return value;}
    function observe(sample){
      if(state!=='waiting'||!request)return null;
      if(sample.page!==request.page||sample.source&&sample.source!==request.url||!sample.connected){cancel('changed');return null;}
      if(sample.now-request.armedAt>=300000){cancel('expired');return null;}
      const media=typeof sample.media==='string'?sample.media:'';
      if(sample.ad){sawAd=true;phase='ad';if(media&&adSources.size<64)adSources.add(media);reset();return null;}
      if(!sawAd&&request.requireAd!==false){phase='ad';reset();return null;}
      if(!media||!sample.playing||!Number.isFinite(sample.time)){phase='source';reset();return null;}
      phase='stabilizing';
      if(stableAt===null||media!==lastMedia||sample.time<mediaAt){stableAt=sample.now;mediaAt=sample.time;lastMedia=media;return null;}
      if(sample.now-stableAt<1500||sample.time-mediaAt<.5)return null;
      let mediaUrl;
      if(sawAd&&adSources.size>0&&!adSources.has(media)&&media.length<=4096){
        try{const u=new URL(media);if(/^https?:$/.test(u.protocol)&&!u.username&&!u.password)mediaUrl=u.href;}catch{}
      }
      return start(mediaUrl);
    }
    return {view,arm,observe,cancel,start};
  }
  scope.YVA={create,isAd};if(typeof module!=='undefined')module.exports=scope.YVA;
})(typeof globalThis!=='undefined'?globalThis:this);
