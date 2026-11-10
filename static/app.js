let config, calendar = {events: [], sources: []};
const $ = id => document.getElementById(id);
const icons = () => window.lucide?.createIcons();
const element = (tag, cls, text) => { const el = document.createElement(tag); if(cls) el.className=cls; if(text !== undefined) el.textContent=text; return el; };
const hiddenCalendarsKey='kitchen-hidden-calendars';
function readHiddenCalendars(){
  try{
    const saved=JSON.parse(localStorage.getItem(hiddenCalendarsKey)||'[]');
    return new Set(Array.isArray(saved)?saved.filter(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0,200):[]);
  }catch{return new Set();}
}
let hiddenCalendars=readHiddenCalendars();
const themeKey=KitchenAppearance.key;
const themeToggle=element('button','icon-button');themeToggle.id='theme-toggle';themeToggle.type='button';themeToggle.disabled=true;
themeToggle.title='Switch to light mode';themeToggle.setAttribute('aria-label',themeToggle.title);
const themeGlyph=element('i');themeGlyph.dataset.lucide='sun-moon';themeToggle.append(themeGlyph);
document.querySelector('.night-controls').before(themeToggle);
function applyTheme(){
  if(!config)return;
  const theme=KitchenAppearance.apply(config);
  themeToggle.disabled=false;themeToggle.title=theme==='dark'?'Switch to light mode':'Switch to dark mode';
  themeToggle.setAttribute('aria-label',themeToggle.title);themeToggle.setAttribute('aria-pressed',String(theme==='light'));
}
themeToggle.onclick=()=>{
  if(!config)return;
  const theme=document.body.dataset.theme==='dark'?'light':'dark';
  KitchenAppearance.set(config,theme);
  themeToggle.title=theme==='dark'?'Switch to light mode':'Switch to dark mode';
  themeToggle.setAttribute('aria-label',themeToggle.title);themeToggle.setAttribute('aria-pressed',String(theme==='light'));
};
window.addEventListener('storage',event=>{
  if(event.key===themeKey||event.key===null)applyTheme();
});
function saveHiddenCalendars(){
  try{localStorage.setItem(hiddenCalendarsKey,JSON.stringify([...hiddenCalendars]));}catch{}
  render();
}
function toggleCalendar(id){
  if(hiddenCalendars.has(id))hiddenCalendars.delete(id);else hiddenCalendars.add(id);
  saveHiddenCalendars();
  Array.from($('legend').children).find(item=>item.dataset.calendarId===id)?.focus({preventScroll:true});
}
$('show-calendars').onclick=()=>{if(config){hiddenCalendars.clear();saveHiddenCalendars();}};
$('hide-calendars').onclick=()=>{if(config){for(const source of config.calendars.filter(s=>s.enabled))hiddenCalendars.add(source.id);saveHiddenCalendars();}};
window.addEventListener('storage',event=>{
  if(event.key===hiddenCalendarsKey||event.key===null){hiddenCalendars=readHiddenCalendars();if(config)render();}
});
function calendarIcon(sourceId){const icon=element('i');icon.dataset.lucide=config.calendars.find(c=>c.id===sourceId)?.icon||'calendar-days';return icon;}
function dateKey(value) { return new Intl.DateTimeFormat('en-CA', {timeZone: config.timezone, year:'numeric',month:'2-digit',day:'2-digit'}).format(value); }
function parseDate(key) { return new Date(`${key}T12:00:00Z`); }
function addDays(day, count) { const result = new Date(day); result.setUTCDate(result.getUTCDate()+count); return result; }
function fmt(day, options) { return new Intl.DateTimeFormat('en-AU', {timeZone:config.timezone, ...options}).format(day); }
function clock() {
  const now = new Date();
  $('weekday').textContent=fmt(now,{weekday:'long'});
  $('date').textContent=fmt(now,{day:'numeric',month:'long',year:'numeric'});
  const parts=new Intl.DateTimeFormat('en-AU',{timeZone:config.timezone,hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).formatToParts(now);
  $('clock').textContent=parts.filter(p=>p.type!=='dayPeriod').map(p=>p.value).join('').trim();
  $('ampm').textContent=parts.find(p=>p.type==='dayPeriod')?.value.toUpperCase();
  const changed=clock.day && clock.day !== dateKey(now);
  clock.day=dateKey(now);
  if(changed) render();
}
function eventsFor(day) {
  const key=dateKey(day);
  return calendar.events.filter(e=> {
    if(hiddenCalendars.has(e.sourceId))return false;
    if(e.allDay) return e.start<=key && e.end>key;
    const start=dateKey(new Date(e.start)), end=dateKey(new Date(new Date(e.end).getTime()-1));
    return start<=key && end>=key;
  }).sort((a,b)=>Number(b.allDay)-Number(a.allDay) || a.start.localeCompare(b.start));
}
function eventTime(event, detailed=false) {
  if(event.allDay) return 'All day';
  const start=new Date(event.start),end=new Date(event.end);
  const sameDay=dateKey(start)===dateKey(end);
  const options={timeZone:config.timezone,hour:'numeric',minute:'2-digit',hour12:true};
  if(!sameDay){
    if(detailed){options.day='numeric';options.month='short';options.year='numeric';}
    else options.weekday='short';
  }
  const formatter=new Intl.DateTimeFormat('en-AU',options);
  if(start.getTime()===end.getTime())return `${formatter.format(start)} – ${formatter.format(end)}`;
  const parts=formatter.formatRangeToParts(start,end);
  return parts.map((part,i)=>{
    if(part.type==='literal'&&part.value.trim()==='–')return '–';
    if(part.type==='literal'&&!part.value.trim()&&parts[i+1]?.type==='dayPeriod')return '';
    return part.value;
  }).join('');
}
function eventTimeLabel(event,detailed=false){
  const label=element('span','event-time');
  const text=eventTime(event,detailed),split=text.indexOf('–');
  if(split<0)label.textContent=text;
  else label.append(document.createTextNode(text.slice(0,split+1)),document.createElement('wbr'),document.createTextNode(text.slice(split+1)));
  return label;
}
function showDetails(day) {
  $('details-title').textContent=fmt(day,{weekday:'long',day:'numeric',month:'long'});
  $('details-events').replaceChildren();
  const events=eventsFor(day);
  if(!events.length) $('details-events').append(element('p','empty-day','No events'));
  for(const event of events) {
    const row=element('article','detail-event'); row.style.setProperty('--event-color',event.color);
    row.append(eventTimeLabel(event,true),element('h3','',event.title),element('p','detail-source',event.source));
    if(event.location) row.append(element('p','',event.location));
    $('details-events').append(row);
  }
  $('details').showModal();
}
function weekGrid(start, compact=false) {
  const grid=element('div',compact?'week-grid compact':'week-grid');
  for(let i=0;i<7;i++) {
    const day=addDays(start,i), today=dateKey(day)===dateKey(new Date());
    const column=element('div',`day${today?' today':''}${i>4?' weekend':''}`);
    const heading=element('button','day-heading'); heading.type='button';
    heading.append(element('span','day-name',fmt(day,{weekday:'short'})),element('strong','day-number',fmt(day,{day:'numeric'})));
    heading.setAttribute('aria-label',fmt(day,{weekday:'long',day:'numeric',month:'long'}));
    heading.onclick=()=>showDetails(day);column.append(heading);
    const events=eventsFor(day), limit=compact?2:Math.max(2,Math.floor((config.weekHeight-140)/92));
    const list=element('div','day-events');
    for(const event of events.slice(0,limit)) {
      const button=element('button','event'); button.type='button'; button.style.setProperty('--event-color',event.color);
      const header=element('span','event-header');header.append(calendarIcon(event.sourceId),eventTimeLabel(event));
      button.title=`${event.title}\n${eventTime(event,true)}`;
      button.append(header,element('span','event-title',event.title));
      button.onclick=()=>showDetails(day); list.append(button);
    }
    if(events.length>limit){const more=element('button','more',`+${events.length-limit} more`);more.onclick=()=>showDetails(day);list.append(more);}
    if(!events.length)list.append(element('span','day-dash','\u2014'));
    column.append(list);grid.append(column);
  }
  return grid;
}
function render() {
  applyTheme();
  document.documentElement.style.setProperty('--week-height',`${config.weekHeight}px`);
  document.documentElement.style.setProperty('--camera-height',`${config.cameraHeight}px`);
  document.documentElement.style.setProperty('--font-weight',config.fontWeight);
  renderCameras();
  document.documentElement.style.setProperty('--upcoming-height',`${config.upcomingWeeks*213}px`);
  $('title').textContent=config.title;
  $('title').hidden=!config.title;
  const today=parseDate(dateKey(new Date())), monday=addDays(today,-((today.getUTCDay()+6)%7));
  $('week-range').textContent=`${fmt(monday,{day:'numeric',month:'short'})} – ${fmt(addDays(monday,6),{day:'numeric',month:'short'})}`;
  $('month-label').textContent=fmt(addDays(monday,7),{month:'long',year:'numeric'});
  $('week').replaceWith(Object.assign(weekGrid(monday),{id:'week'}));
  $('legend').replaceChildren();
  const enabledSources=config.calendars.filter(s=>s.enabled);
  for(const source of enabledSources) {
    const item=element('button','legend-item');item.type='button';item.dataset.calendarId=source.id;
    const visible=!hiddenCalendars.has(source.id);
    item.setAttribute('aria-pressed',String(visible));item.title=`${visible?'Hide':'Show'} ${source.name}`;
    const glyph=calendarIcon(source.id);glyph.style.color=source.color;
    item.append(glyph,element('span','',source.name));item.onclick=()=>toggleCalendar(source.id);$('legend').append(item);
  }
  $('show-calendars').disabled=!enabledSources.some(s=>hiddenCalendars.has(s.id));
  $('hide-calendars').disabled=!enabledSources.some(s=>!hiddenCalendars.has(s.id));
  document.querySelector('.calendar-filters').hidden=!enabledSources.length;
  const scrollTop=$('upcoming').scrollTop;
  $('upcoming').replaceChildren();
  for(let w=1;w<=26;w++){
    const start=addDays(monday,w*7), section=element('div','future-week');
    section.dataset.month=fmt(start,{month:'long',year:'numeric'});
    section.append(element('h3','future-label',`${fmt(start,{day:'numeric',month:'short'})} – ${fmt(addDays(start,6),{day:'numeric',month:'short'})}`),weekGrid(start,true));
    $('upcoming').append(section);
  }
  $('upcoming').scrollTop=scrollTop;
  updateUpcomingMonth();
  requestAnimationFrame(fitUpcoming);
  const enabled=config.calendars.filter(s=>s.enabled&&s.configured);
  const failed=calendar.sources.filter(s=>s.state!=='ready');
  $('connection-state').textContent=enabled.length ? failed.map(s=>`${s.name}: ${s.state}`).join(' · ') : 'No calendars connected';
  icons();clock();updateNightMode();
}
async function update(){
  try {
    const responses=await Promise.all([fetch('/api/settings'),fetch('/api/events')]);
    if(responses.some(r=>!r.ok))throw Error();
    [config,calendar]=await Promise.all(responses.map(r=>r.json()));render();
  } catch { $('connection-state').textContent='Display server unavailable · retrying'; }
}
const players=new Map();
let cameraFocus;
function openCameras(){
  cameraFocus=document.activeElement;
  $('cameras').classList.add('expanded');document.body.classList.add('camera-mode');
  $('cameras').setAttribute('role','dialog');$('cameras').setAttribute('aria-modal','true');
  $('close-cameras').hidden=false;$('close-cameras').focus();
}
function closeCameras(){
  $('cameras').classList.remove('expanded');document.body.classList.remove('camera-mode');
  $('cameras').removeAttribute('role');$('cameras').removeAttribute('aria-modal');
  $('close-cameras').hidden=true;cameraFocus?.focus();
}
$('close-cameras').onclick=closeCameras;
document.addEventListener('keydown',event=>{
  if(!$('cameras').classList.contains('expanded'))return;
  if(event.key==='Escape')closeCameras();
  if(event.key==='Tab'){
    const controls=[$('close-cameras'),...$('cameras').querySelectorAll('.camera-refresh')];
    const current=controls.indexOf(document.activeElement);
    event.preventDefault();controls[(current+(event.shiftKey?-1:1)+controls.length)%controls.length].focus();
  }
});
function fitUpcoming(){
  if(!config)return;
  const box=$('upcoming');
  box.style.height=`${Math.min(config.upcomingWeeks*213,Math.max(220,innerHeight-box.getBoundingClientRect().top-22))}px`;
}
window.addEventListener('resize',fitUpcoming);
document.fonts.ready.then(()=>requestAnimationFrame(fitUpcoming));
function renderCameras(){
  $('cameras').hidden=!config.showCamera||!config.cameras?.length;
  const desired=new Set(config.showCamera?(config.cameras||[]).map(c=>c.id):[]);
  for(const [id,p] of players){if(!desired.has(id)){p.closed=true;clearTimeout(p.retry);p.hls?.destroy();p.video.pause();p.panel.remove();players.delete(id);}}
  if(!config.showCamera||!config.cameras?.length){closeCameras();return;}
  for(const [index,camera] of (config.cameras||[]).entries()){
    let p=players.get(camera.id);
    if(!p){
      const panel=element('div','camera offline');panel.dataset.camera=camera.id;
      const video=element('video');video.muted=true;video.autoplay=true;video.playsInline=true;video.setAttribute('aria-label',camera.name);
      const dot=element('span','live-dot');dot.setAttribute('role','status');dot.setAttribute('aria-label',`${camera.name}: connecting`);
      const expand=element('button','icon-button camera-expand');expand.type='button';expand.title=`Expand ${camera.name}`;expand.setAttribute('aria-label',expand.title);expand.innerHTML='<i data-lucide="expand"></i>';
      expand.onclick=openCameras;
      const refresh=element('button','icon-button camera-refresh');refresh.type='button';refresh.title=`Restart ${camera.name} connection`;refresh.setAttribute('aria-label',refresh.title);refresh.innerHTML='<i data-lucide="refresh-cw"></i>';
      const error=element('p','camera-error','Connecting');panel.append(video,dot,expand,refresh,error);$('cameras').append(panel);
      p={panel,video,dot,error,refresh,lastTime:-1,lastAdvance:0,closed:false};players.set(camera.id,p);
      p.connect=()=>{
        if(p.closed)return;
        clearTimeout(p.retry);p.retry=null;
        const previous=p.hls;p.hls=null;previous?.destroy();
        video.pause();video.removeAttribute('src');video.load();
        p.lastTime=-1;p.lastAdvance=0;panel.classList.add('offline');error.hidden=false;error.textContent='Reconnecting';
        refresh.setAttribute('aria-busy','true');dot.setAttribute('aria-label',`${camera.name}: reconnecting`);
        const url=`/api/stream.m3u8?src=${encodeURIComponent(camera.id)}`;
        if(window.Hls?.isSupported()){
          const hls=new Hls({enableWorker:false,liveSyncDurationCount:2,liveMaxLatencyDurationCount:5,backBufferLength:10,maxBufferLength:6});p.hls=hls;
          hls.loadSource(url);hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(p.hls===hls)video.play().catch(()=>{});});
          hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal&&p.hls===hls){p.hls=null;hls.destroy();clearTimeout(p.retry);p.retry=setTimeout(p.connect,5000);}});
        }else if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=url;video.play().catch(()=>{});}
        else{error.textContent='Video playback unavailable';}
      };refresh.onclick=()=>p.connect();p.connect();
    }
    p.video.style.objectFit=config.cameraFit;
    p.video.setAttribute('aria-label',camera.name);
    p.refresh.title=`Restart ${camera.name} connection`;p.refresh.setAttribute('aria-label',p.refresh.title);
    const slot=$('cameras').children[index+1];
    if(slot!==p.panel)$('cameras').insertBefore(p.panel,slot||null);
  }
}
setInterval(()=>{for(const [id,p] of players){
  const camera=config?.cameras?.find(c=>c.id===id);
  if(p.video.currentTime>p.lastTime+.05){p.lastTime=p.video.currentTime;p.lastAdvance=Date.now();}
  const live=p.video.readyState>=2&&Date.now()-p.lastAdvance<5000;
  p.refresh.setAttribute('aria-busy',String(!live));
  p.panel.classList.toggle('offline',!live);p.error.hidden=live;p.error.textContent='Reconnecting';
  p.dot.setAttribute('aria-label',`${camera?.name||'Camera'}: ${live?'live':'offline'}`);
}},1000);
$('refresh').onclick=async()=>{
  $('refresh').disabled=true;
  try{const response=await fetch('/api/refresh',{method:'POST',headers:{'Content-Type':'application/json','X-Kitchen-Request':'1'},body:'{}'});if(!response.ok)throw Error();setTimeout(update,2000);}
  catch{$('connection-state').textContent='Calendar refresh failed';}
  finally{$('refresh').disabled=false;}
};
$('close-details').onclick=()=>$('details').close();
$('details').onclick=e=>{if(e.target===$('details'))$('details').close();};
function updateUpcomingMonth(){
  const top=$('upcoming').getBoundingClientRect().top;
  const visible=Array.from($('upcoming').children).find(section=>section.getBoundingClientRect().bottom>top+50);
  if(visible)$('month-label').textContent=visible.dataset.month;
}
$('upcoming').addEventListener('scroll',updateUpcomingMonth,{passive:true});
const nightDimmer=element('div','night-dimmer');nightDimmer.setAttribute('aria-hidden','true');document.body.append(nightDimmer);
const nightModeKey='kitchen-night-mode';
let nightMode='auto';
function readNightMode(){
  try{
    const raw=localStorage.getItem(nightModeKey);
    if(['on','off'].includes(raw))return {mode:raw,legacy:true};
    const saved=JSON.parse(raw||'null');return saved&&['on','off'].includes(saved.mode)?saved:null;
  }catch{return null;}
}
let nightOverride=readNightMode();
function storeNightOverride(){
  try{if(nightOverride)localStorage.setItem(nightModeKey,JSON.stringify(nightOverride));else localStorage.removeItem(nightModeKey);}catch{}
}
function setNightMode(mode){
  nightOverride=mode==='auto'?null:makeNightOverride(config,mode);
  storeNightOverride();
  updateNightMode();
}
$('night-toggle').onclick=()=>{if(config){updateNightMode();setNightMode(nightActive(config,new Date(),nightMode)?'off':'on');}};
$('night-auto').onclick=()=>setNightMode('auto');
window.addEventListener('storage',event=>{
  if(event.key===nightModeKey||event.key===null){nightOverride=readNightMode();updateNightMode();}
});
function updateNightMode(){
  if(!config)return;
  if(nightOverride?.legacy){nightOverride=makeNightOverride(config,nightOverride.mode);storeNightOverride();}
  nightMode=overrideMode(config,nightOverride);
  if(nightOverride&&nightMode==='auto'){nightOverride=null;storeNightOverride();}
  const active=nightActive(config,new Date(),nightMode);
  document.documentElement.style.setProperty('--night-brightness',`${config.nightBrightness}%`);
  nightDimmer.style.opacity=String(active?1-config.nightBrightness/100:0);
  document.body.dataset.night=String(active);
  document.body.dataset.nightMode=nightMode;
  const toggle=$('night-toggle'),automatic=$('night-auto');
  toggle.disabled=false;
  const action=active?'Turn night mode off':'Turn night mode on';
  toggle.title=action;toggle.setAttribute('aria-label',action);toggle.setAttribute('aria-pressed',String(active));
  toggle.dataset.manual=String(nightMode!=='auto');
  const glyph=active?'sun':'moon';
  if(toggle.dataset.glyph!==glyph){const icon=element('i');icon.dataset.lucide=glyph;toggle.replaceChildren(icon);toggle.dataset.glyph=glyph;icons();}
  automatic.disabled=nightMode==='auto';
  automatic.title=nightMode==='auto'?'Following night schedule':'Return to automatic night schedule';
  automatic.setAttribute('aria-label',automatic.title);
}
update();setInterval(update,30000);setInterval(()=>{if(config){clock();updateNightMode();}},1000);
