/* Bounded deferred download. An unmarked ended/src-change is not proof of an ad. */
(function(scope){
  function isAd(video){return Boolean(video?.closest?.('.vjs-ad-playing,.vjs-ad-loading,.ad-showing,.ad-interrupting,[data-ad="true"],[data-is-ad="true"],[itemprop="advertisement"],[aria-label="Advertisement" i],[aria-label="Реклама" i]'));}
  function create(){
    let request=null,state='idle',sawAd=false,stableAt=null,mediaAt=null;
    const view=()=>({state,sawAd});
    function cancel(reason='cancelled'){request=null;state=reason;stableAt=null;mediaAt=null;return view();}
    function arm(context,now){request={...context,armedAt:now};state='waiting';sawAd=false;stableAt=null;mediaAt=null;return view();}
    function start(){if(state!=='waiting'||!request)return null;const value=request;request=null;state='started';return value;}
    function observe(sample){
      if(state!=='waiting'||!request)return null;
      if(sample.page!==request.page||sample.source&&sample.source!==request.url||!sample.connected){cancel('changed');return null;}
      if(sample.now-request.armedAt>=300000){cancel('expired');return null;}
      if(sample.ad){sawAd=true;stableAt=null;mediaAt=null;return null;}
      if(!sawAd||!sample.playing||!Number.isFinite(sample.time)){stableAt=null;mediaAt=null;return null;}
      if(stableAt===null||sample.time<mediaAt){stableAt=sample.now;mediaAt=sample.time;return null;}
      if(sample.now-stableAt>=1500&&sample.time-mediaAt>=.5)return start();
      return null;
    }
    return {view,arm,observe,cancel,start};
  }
  scope.YVA={create,isAd};if(typeof module!=='undefined')module.exports=scope.YVA;
})(typeof globalThis!=='undefined'?globalThis:this);
