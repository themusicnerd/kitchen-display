(function(root){
  function nightActive(config,now=new Date(),mode='auto'){
    if(mode==='on')return true;
    if(mode==='off')return false;
    if(!config.nightEnabled)return false;
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
    const minutes=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
    const parse=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
    const start=parse(config.nightStart),end=parse(config.nightEnd);
    return start!==end&&(start<end?minutes>=start&&minutes<end:minutes>=start||minutes<end);
  }
  function scheduleKey(config){return JSON.stringify([config.nightEnabled,config.nightStart,config.nightEnd,config.timezone]);}
  function nextNightBoundary(config,now=new Date()){
    if(!config.nightEnabled||config.nightStart===config.nightEnd)return null;
    const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    let previous=nightActive(config,now);
    for(let time=(Math.floor(now.getTime()/60000)+1)*60000;time<=now.getTime()+49*3600000;time+=60000){
      const date=new Date(time),local=formatter.format(date);
      const active=config.nightStart<config.nightEnd?local>=config.nightStart&&local<config.nightEnd:local>=config.nightStart||local<config.nightEnd;
      if(local===config.nightStart||local===config.nightEnd||active!==previous)return time;
      previous=active;
    }
    return null;
  }
  function makeNightOverride(config,mode,now=new Date()){
    return {mode,expiresAt:nextNightBoundary(config,now),schedule:scheduleKey(config)};
  }
  function overrideMode(config,override,now=new Date()){
    if(!override||!['on','off'].includes(override.mode)||override.schedule!==scheduleKey(config))return 'auto';
    if(override.expiresAt!==null&&(!Number.isFinite(override.expiresAt)||now.getTime()>=override.expiresAt))return 'auto';
    return override.mode;
  }
  const api={nightActive,nextNightBoundary,makeNightOverride,overrideMode};
  if(typeof module!=='undefined')module.exports=api;
  else Object.assign(root,api);
})(globalThis);
