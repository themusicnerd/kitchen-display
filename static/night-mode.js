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
  if(typeof module!=='undefined')module.exports={nightActive};
  else root.nightActive=nightActive;
})(globalThis);
