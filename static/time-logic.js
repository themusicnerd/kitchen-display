(function(root){
  const MAX_TIMER=100*3600000-1000;
  function hourFraction(remainingMs){return Math.max(0,Math.min(1,remainingMs/3600000));}
  function remaining(timer,now=Date.now()){
    return Math.max(0,timer.status==='running'?timer.endAt-now:timer.remainingMs);
  }
  function elapsed(stopwatch,now=Date.now()){
    return stopwatch.elapsedMs+(stopwatch.startedAt===null?0:Math.max(0,now-stopwatch.startedAt));
  }
  function durationText(ms,fraction=false){
    const value=Math.max(0,Math.floor(ms/(fraction?10:1000)));
    const seconds=fraction?Math.floor(value/100):value;
    const text=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':');
    return text+(fraction?'.'+String(value%100).padStart(2,'0'):'');
  }
  function localParts(date,timezone){
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  }
  function zonedTime(day,time,timezone){
    const [hour,minute]=time.split(':').map(Number),target=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),hour,minute);
    let guess=target;
    for(let i=0;i<4;i++){
      const parts=localParts(new Date(guess),timezone);
      const delta=target-Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
      if(!delta)break;
      guess+=delta;
    }
    return guess;
  }
  function activityTargets(config,group,variant='lunch-in',now=new Date()){
    const p=localParts(now,config.timezone);
    const timers=(config.visualTimers||[]).filter(timer=>timer.enabled&&timer.group===group&&(timer.variant==='any'||timer.variant===variant));
    const build=offset=>timers.map(timer=>{
      const day=new Date(Date.UTC(p.year,p.month-1,p.day+offset,12));
      for(let n=0;n<7&&!timer.days.includes(day.getUTCDay());n++)day.setUTCDate(day.getUTCDate()+1);
      return {...timer,day:day.toISOString().slice(0,10),at:zonedTime(day,timer.time,config.timezone)};
    }).sort((a,b)=>a.at-b.at);
    const today=build(0);
    return today.length&&today.every(timer=>timer.at<=now.getTime())?build(1):today;
  }
  const api={MAX_TIMER,hourFraction,remaining,elapsed,durationText,activityTargets,localParts};
  if(typeof module!=='undefined')module.exports=api;else root.KitchenTiming=api;
})(globalThis);
