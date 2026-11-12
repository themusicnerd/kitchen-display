(function(){
  const $=id=>document.getElementById(id),token=location.hash.slice(1);
  let snapshot=null,offset=0,context=null,stopped=false;
  const stopwatch=document.createElement('output');stopwatch.id='tv-stopwatch-time';stopwatch.className='tv-stopwatch-clock';stopwatch.setAttribute('role','timer');
  $('tv-timer').append(stopwatch);
  const laps=document.createElement('ol');laps.id='tv-stopwatch-laps';$('tv-title').parentElement.append(laps);
  try{
    context=window.cast?.framework?.CastReceiverContext.getInstance();
    if(context)context.start({disableIdleTimeout:true,customNamespaces:{'urn:x-cast:kitchen.timer':cast.framework.system.MessageType.JSON}});
  }catch{context=null;}
  function fit(){const r=$('tv-dial-space').getBoundingClientRect();$('activity-dial').style.setProperty('--dial-size',Math.floor(Math.max(0,Math.min(r.width,r.height)))+'px');}
  new ResizeObserver(fit).observe($('tv-dial-space'));window.addEventListener('resize',fit);
  function tick(){
    if(!snapshot||stopped)return;
    if(snapshot.timer.kind==='stopwatch'){
      const timer=snapshot.timer,elapsed=timer.elapsedMs+(timer.status==='running'?Math.max(0,Date.now()+offset-timer.startedAt):0);
      stopwatch.textContent=KitchenTiming.durationText(elapsed,true);
      $('tv-state').textContent={running:'Running',paused:'Paused',idle:'Ready'}[timer.status];
      return;
    }
    const timer=snapshot.timer,remaining=Math.max(0,timer.status==='running'?timer.endAt-(Date.now()+offset):timer.remainingMs);
    const hour=KitchenTiming.hourFraction(remaining),minute=KitchenTiming.minuteFraction(remaining),dial=$('activity-dial');
    $('activity-focus-remaining').textContent=KitchenTiming.countdownText(remaining);
    dial.style.setProperty('--pie-angle',(hour*360).toFixed(3)+'deg');dial.style.setProperty('--minute-angle',(minute*360).toFixed(3)+'deg');
    $('activity-pie').setAttribute('aria-valuenow',(hour*60).toFixed(1));$('activity-minute-ring').setAttribute('aria-valuenow',(minute*60).toFixed(1));
    $('tv-state').textContent=timer.status==='paused'?'Paused':timer.status==='idle'?'Ready':remaining?'':'Time reached';
  }
  function end(){
    stopped=true;snapshot=null;$('tv-timer').hidden=true;$('tv-message').hidden=false;$('tv-message').textContent='Timer sharing ended';
    try{context?.stop();}catch{}
  }
  async function refresh(){
    if(stopped)return;
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)){end();return;}
    try{
      const before=Date.now(),response=await fetch('/cast/state',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      if([403,410].includes(response.status)){end();return;}
      if(!response.ok)throw Error('Unavailable');
      const value=await response.json();offset=value.serverNow-(before+Date.now())/2;snapshot=value;
      document.body.dataset.theme=value.theme;document.body.dataset.paper=String(value.paperTexture);
      $('tv-title').textContent=value.timer.name;
      $('tv-timer').dataset.kind=value.timer.kind;
      laps.replaceChildren();
      if(value.timer.kind==='stopwatch')for(const [index,lap] of value.timer.laps.map((lap,index)=>[index,lap]).slice(-5).reverse()){
        const row=document.createElement('li');row.textContent='Lap '+(index+1)+'   '+KitchenTiming.durationText(lap,true);laps.append(row);
      }
      $('tv-at').textContent=value.timer.endAt?new Intl.DateTimeFormat('en-AU',{timeZone:value.timezone,weekday:'long',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value.timer.endAt)):'';
      $('tv-timer').hidden=false;$('tv-message').hidden=true;tick();fit();
    }catch{
      if(!snapshot)$('tv-message').textContent='Waiting for the kitchen display...';
      else $('tv-state').textContent='Reconnecting';
    }
  }
  refresh();setInterval(refresh,2000);setInterval(tick,100);
})();
