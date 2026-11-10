(function(){
  const T=KitchenTiming,key='kitchen-time-tools';
  const empty=()=>({timers:[],stopwatch:{elapsedMs:0,startedAt:null,laps:[]},sound:true});
  let state=empty(),audio,lastBeep=0,view='timers',group='',variant='lunch-in',activitySignature='';
  try{const choice=localStorage.getItem('kitchen-activity-lunch');if(['lunch-in','lunch-out'].includes(choice))variant=choice;}catch{}
  try{
    const saved=JSON.parse(localStorage.getItem(key)||'null');
    if(saved){
      state.sound=saved.sound!==false;
      state.timers=(Array.isArray(saved.timers)?saved.timers:[]).slice(0,8).filter(t=>t&&typeof t.id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(t.id)&&Number.isFinite(t.durationMs)&&t.durationMs>0&&t.durationMs<=T.MAX_TIMER&&Number.isFinite(t.remainingMs)&&t.remainingMs>=0&&t.remainingMs<=T.MAX_TIMER&&['idle','running','paused','finished'].includes(t.status)&&(t.status!=='running'||Number.isFinite(t.endAt))).map(t=>({...t,name:String(t.name||'Timer').slice(0,40)}));
      const s=saved.stopwatch;
      if(s&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>=0&&(s.startedAt===null||Number.isFinite(s.startedAt)))state.stopwatch={elapsedMs:s.elapsedMs,startedAt:s.startedAt,laps:(Array.isArray(s.laps)?s.laps:[]).filter(Number.isFinite).slice(0,100)};
    }
  }catch{}
  const dialog=document.createElement('dialog');dialog.id='time-tools';dialog.className='time-tools';dialog.setAttribute('aria-labelledby','tools-heading');
  dialog.innerHTML='<div class="tools-shell"><header class="tools-heading"><h2 id="tools-heading">Timers</h2><button id="timer-sound" class="icon-button" type="button" title="Mute timer sound" aria-label="Mute timer sound"></button><button id="close-time-tools" class="icon-button" type="button" title="Back to calendar" aria-label="Back to calendar"><i data-lucide="x"></i></button></header><div class="tools-tabs" role="tablist" aria-label="Clock views"><button id="tab-timers" role="tab" aria-controls="pane-timers" type="button">Timers</button><button id="tab-stopwatch" role="tab" aria-controls="pane-stopwatch" type="button">Stopwatch</button><button id="tab-activities" role="tab" aria-controls="pane-activities" type="button">Get ready</button></div><section id="pane-timers" role="tabpanel" aria-labelledby="tab-timers"><div class="tools-actions"><button id="add-timer" type="button" class="secondary"><i data-lucide="plus"></i>Add timer</button></div><div id="timer-list"></div></section><section id="pane-stopwatch" role="tabpanel" aria-labelledby="tab-stopwatch" hidden><output id="stopwatch-time" class="stopwatch-time">00:00:00.00</output><div class="stopwatch-controls"><button id="stopwatch-toggle" class="icon-button" type="button"></button><button id="stopwatch-lap" class="icon-button" type="button" title="Record lap" aria-label="Record lap"><i data-lucide="flag"></i></button><button id="stopwatch-reset" class="icon-button" type="button" title="Reset stopwatch" aria-label="Reset stopwatch"><i data-lucide="rotate-ccw"></i></button></div><ol id="stopwatch-laps" class="stopwatch-laps"></ol></section><section id="pane-activities" role="tabpanel" aria-labelledby="tab-activities" hidden><div class="activity-options"><label>Activity<select id="activity-group"></select></label><div id="lunch-options" class="tools-tabs" role="group" aria-label="Lunch option"><button type="button" data-lunch="lunch-out">Lunch out</button><button type="button" data-lunch="lunch-in">Lunch at home</button></div></div><div id="activity-timers" class="activity-timers"></div></section><p id="tools-status" class="tools-status" role="status"></p></div>';
  document.body.append(dialog);
  const el=id=>document.getElementById(id);
  el('close-time-tools').classList.add('view-close');
  const activityFocus=document.createElement('section');activityFocus.id='activity-focus';activityFocus.className='activity-focus-view';activityFocus.hidden=true;activityFocus.setAttribute('aria-labelledby','activity-focus-title');
  activityFocus.innerHTML='<header class="activity-focus-heading"><div><h3 id="activity-focus-title"></h3><p id="activity-focus-at" class="activity-at"></p></div><button id="activity-unfocus" class="icon-button view-close" type="button" title="All timers" aria-label="Back to all activity timers"><i data-lucide="arrow-left"></i></button></header><div id="activity-dial-space" class="activity-dial-space"><div id="activity-dial" class="activity-dial"><div id="activity-pie" class="activity-pie" role="progressbar" aria-valuemin="0" aria-valuemax="60"></div><span class="dial-mark dial-mark-top" aria-hidden="true">60</span><span class="dial-mark dial-mark-right" aria-hidden="true">15</span><span class="dial-mark dial-mark-bottom" aria-hidden="true">30</span><span class="dial-mark dial-mark-left" aria-hidden="true">45</span><div class="activity-focus-clock"><output id="activity-focus-remaining" role="timer"></output><p id="activity-focus-state"></p></div></div></div>';
  el('pane-activities').append(activityFocus);
  let focusedActivity=null,activityOrigin=null,activityListScroll=0;
  function fitActivityDial(){
    if(!focusedActivity||!dialog.open)return;
    const rect=el('activity-dial-space').getBoundingClientRect();
    el('activity-dial').style.setProperty('--dial-size',Math.floor(Math.max(0,Math.min(rect.width,rect.height)))+'px');
  }
  function leaveActivityFocus(restore=true){
    if(!focusedActivity)return;
    focusedActivity=null;activityFocus.hidden=true;el('activity-timers').hidden=false;dialog.classList.remove('activity-focused');
    if(restore){dialog.scrollTop=activityListScroll;if(activityOrigin?.isConnected)activityOrigin.focus({preventScroll:true});else el('activity-group').focus();}
    activityOrigin=null;
  }
  function updateActivityHeading(){
    el('activity-focus-title').textContent=focusedActivity.name;
    el('activity-focus-at').textContent=new Intl.DateTimeFormat('en-AU',{timeZone:config.timezone,weekday:'long',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(focusedActivity.at));
    el('activity-pie').setAttribute('aria-label','Final hour until '+focusedActivity.name);
  }
  function focusActivity(target,button){
    activityListScroll=dialog.scrollTop;activityOrigin=button;focusedActivity={...target};
    dialog.classList.add('activity-focused');el('activity-timers').hidden=true;activityFocus.hidden=false;dialog.scrollTop=0;
    updateActivityHeading();tick();fitActivityDial();requestAnimationFrame(fitActivityDial);el('activity-unfocus').focus();
  }
  el('activity-unfocus').onclick=()=>leaveActivityFocus();
  new ResizeObserver(fitActivityDial).observe(el('activity-dial-space'));
  window.addEventListener('resize',fitActivityDial);
  dialog.addEventListener('cancel',event=>{if(focusedActivity){event.preventDefault();leaveActivityFocus();}});
  function glyph(button,name,label){
    button.title=label;button.setAttribute('aria-label',label);
    if(button.dataset.glyph!==name){const i=document.createElement('i');i.dataset.lucide=name;button.replaceChildren(i);button.dataset.glyph=name;window.lucide?.createIcons();}
  }
  function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch{}}
  function unlockSound(){try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume().catch(()=>{});}catch{}}
  function beep(){
    if(!state.sound||!audio||audio.state!=='running')return;
    for(let i=0;i<3;i++){
      const oscillator=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+i*.3;
      oscillator.frequency.value=660;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.065,at+.02);gain.gain.exponentialRampToValueAtTime(.001,at+.2);
      oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(at);oscillator.stop(at+.23);
    }
  }
  function addTimer(){
    if(state.timers.length>=8)return;
    state.timers.push({id:crypto.randomUUID(),name:'Timer '+(state.timers.length+1),durationMs:300000,remainingMs:300000,endAt:null,status:'idle',acknowledged:false});save();renderTimers();
  }
  function renderTimers(){
    const list=el('timer-list');list.replaceChildren();
    for(const timer of state.timers){
      const row=document.createElement('article');row.className='timer-row';row.dataset.timer=timer.id;
      row.innerHTML='<div class="timer-row-heading"><input class="timer-name" maxlength="40" aria-label="Timer name"><button class="icon-button timer-remove" type="button" title="Remove timer" aria-label="Remove timer"><i data-lucide="trash-2"></i></button></div><output class="timer-remaining" role="timer"></output><div class="timer-duration"><label>Hours<input class="timer-hours" type="number" min="0" max="99" step="1"></label><label>Minutes<input class="timer-minutes" type="number" min="0" max="59" step="1"></label><label>Seconds<input class="timer-seconds" type="number" min="0" max="59" step="1"></label></div><div class="timer-controls"><button class="icon-button timer-toggle" type="button"></button><button class="icon-button timer-reset" type="button" title="Reset timer" aria-label="Reset timer"><i data-lucide="rotate-ccw"></i></button><button class="icon-button timer-extend" type="button" title="Add one minute" aria-label="Add one minute"><i data-lucide="timer-reset"></i></button><button class="icon-button timer-ack" type="button" title="Dismiss timer alert" aria-label="Dismiss timer alert"><i data-lucide="check"></i></button><span class="timer-state"></span></div>';
      const name=row.querySelector('.timer-name');name.value=timer.name;name.onchange=()=>{timer.name=name.value.trim()||'Timer';save();};
      const inputs=['hours','minutes','seconds'].map(unit=>row.querySelector('.timer-'+unit));
      const seconds=Math.round(timer.durationMs/1000);[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].forEach((value,i)=>inputs[i].value=value);
      for(const input of inputs)input.onchange=()=>{
        if(inputs.some(i=>!i.reportValidity()))return;
        const ms=(Number(inputs[0].value)*3600+Number(inputs[1].value)*60+Number(inputs[2].value))*1000;
        if(ms<=0||ms>T.MAX_TIMER){el('tools-status').textContent='Choose a duration greater than zero.';return;}
        timer.durationMs=timer.remainingMs=ms;timer.status='idle';timer.endAt=null;timer.acknowledged=false;el('tools-status').textContent='';save();renderTimers();
      };
      row.querySelector('.timer-remove').onclick=()=>{state.timers=state.timers.filter(t=>t.id!==timer.id);save();renderTimers();};
      row.querySelector('.timer-toggle').onclick=()=>{
        if(inputs.some(input=>!input.reportValidity())||inputs.every(input=>!Number(input.value))){el('tools-status').textContent='Choose a duration greater than zero.';return;}
        unlockSound();const now=Date.now();
        if(timer.status==='running'){timer.remainingMs=T.remaining(timer,now);timer.status=timer.remainingMs?'paused':'finished';timer.endAt=null;}
        else{timer.remainingMs=timer.remainingMs||timer.durationMs;timer.endAt=now+timer.remainingMs;timer.status='running';timer.acknowledged=false;}
        save();tick();
      };
      row.querySelector('.timer-reset').onclick=()=>{Object.assign(timer,{status:'idle',remainingMs:timer.durationMs,endAt:null,acknowledged:false});save();tick();};
      row.querySelector('.timer-extend').onclick=()=>{const value=Math.min(T.MAX_TIMER,T.remaining(timer)+60000);timer.remainingMs=value;if(timer.status==='running')timer.endAt=Date.now()+value;else if(timer.status==='finished')timer.status='paused';timer.acknowledged=false;save();tick();};
      row.querySelector('.timer-ack').onclick=()=>{timer.acknowledged=true;save();tick();};
      list.append(row);
    }
    el('add-timer').disabled=state.timers.length>=8;window.lucide?.createIcons();tick();
  }
  function renderLaps(){
    el('stopwatch-laps').replaceChildren();
    state.stopwatch.laps.forEach((value,index)=>{const row=document.createElement('li');row.textContent=`Lap ${index+1}    ${T.durationText(value,true)}`;el('stopwatch-laps').prepend(row);});
  }
  function showView(next){
    if(next!=='activities')leaveActivityFocus(false);
    view=next;el('tools-heading').textContent={timers:'Timers',stopwatch:'Stopwatch',activities:'Get ready'}[view];
    el('timer-sound').hidden=view!=='timers';
    for(const name of ['timers','stopwatch','activities']){const selected=name===view;el('pane-'+name).hidden=!selected;el('tab-'+name).setAttribute('aria-selected',String(selected));el('tab-'+name).tabIndex=selected?0:-1;}
    if(view==='activities')renderActivities();tick();
  }
  function refreshOptions(){
    const tools=config?.timeToolsEnabled!==false,visual=config?.visualTimersEnabled!==false;
    el('tab-timers').hidden=el('tab-stopwatch').hidden=!tools;el('tab-activities').hidden=!visual;
    el('open-time-tools').disabled=!tools;el('open-school').disabled=!visual;
    if(dialog.open&&((view==='activities'&&!visual)||(view!=='activities'&&!tools))){if(tools)showView('timers');else if(visual)showView('activities');else dialog.close();}
    if(dialog.open&&view==='activities'&&activitySignature!==activityKey())renderActivities();
  }
  function open(next){
    if(!config)return;refreshOptions();
    if(next==='activities'&&config.visualTimersEnabled===false||next!=='activities'&&config.timeToolsEnabled===false)return;
    unlockSound();if(next==='timers'&&!state.timers.length)addTimer();
    showView(next);if(!dialog.open)dialog.showModal();document.body.classList.add('tools-mode');el('close-time-tools').focus();
  }
  function activityKey(){const p=T.localParts(new Date(),config.timezone);return JSON.stringify([config.visualTimers,config.timezone,p.year,p.month,p.day]);}
  function renderActivities(){
    activitySignature=activityKey();
    const timers=(config?.visualTimers||[]).filter(t=>t.enabled),groups=[...new Set(timers.map(t=>t.group))];
    const parts=T.localParts(new Date(),config.timezone),weekday=new Date(Date.UTC(parts.year,parts.month-1,parts.day)).getUTCDay();
    if(!groups.includes(group))group=timers.find(t=>t.days.includes(weekday))?.group||groups[0]||'';
    el('activity-group').replaceChildren();for(const name of groups){const option=document.createElement('option');option.value=option.textContent=name;el('activity-group').append(option);}el('activity-group').value=group;
    el('lunch-options').hidden=!timers.some(t=>t.group===group&&t.variant!=='any');
    for(const button of el('lunch-options').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.lunch===variant));
    const list=el('activity-timers');list.replaceChildren();
    const targets=T.activityTargets(config,group,variant);
    if(focusedActivity){const updated=targets.find(target=>target.id===focusedActivity.id);if(updated){focusedActivity=updated;updateActivityHeading();}else leaveActivityFocus(false);}
    for(const target of targets){
      const row=document.createElement('article');row.className='activity-timer';row.dataset.at=target.at;
      const heading=document.createElement('h3'),icon=document.createElement('i');icon.dataset.lucide=target.icon;heading.append(icon,document.createTextNode(target.name));
      const at=document.createElement('p');at.className='activity-at';at.textContent=new Intl.DateTimeFormat('en-AU',{timeZone:config.timezone,weekday:'long',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(target.at));
      const output=document.createElement('output');output.className='activity-remaining';output.setAttribute('aria-label',target.name+' countdown');
      const progress=document.createElement('progress');progress.max=3600000;progress.setAttribute('aria-label','Final hour until '+target.name);
      const status=document.createElement('p');status.className='activity-state';row.append(heading,at,output,progress,status);list.append(row);
      const expand=document.createElement('button');expand.type='button';expand.className='activity-expand';expand.title='Expand '+target.name;expand.setAttribute('aria-label',expand.title);
      const expandIcon=document.createElement('i');expandIcon.dataset.lucide='expand';expand.append(expandIcon);expand.onclick=()=>focusActivity(target,expand);row.append(expand);
    }
    if(!list.children.length){const message=document.createElement('p');message.className='empty-day';message.textContent='No visual timers';list.append(message);}
    window.lucide?.createIcons();
  }
  function tick(){
    const now=Date.now();let changed=false;
    for(const timer of state.timers){
      if(timer.status==='running'&&T.remaining(timer,now)===0){Object.assign(timer,{status:'finished',remainingMs:0,endAt:null,acknowledged:false});changed=true;}
      const row=el('timer-list').querySelector(`[data-timer="${timer.id}"]`);if(!row)continue;
      row.querySelector('.timer-remaining').textContent=T.durationText(Math.ceil(T.remaining(timer,now)/1000)*1000);
      row.dataset.status=timer.status;row.querySelector('.timer-state').textContent={idle:'Ready',running:'Running',paused:'Paused',finished:timer.acknowledged?'Finished':'Time is up'}[timer.status];
      glyph(row.querySelector('.timer-toggle'),timer.status==='running'?'pause':'play',timer.status==='running'?'Pause timer':'Start timer');
      row.querySelector('.timer-ack').hidden=timer.status!=='finished'||timer.acknowledged;
      for(const input of row.querySelectorAll('.timer-duration input'))input.disabled=timer.status==='running';
    }
    if(changed)save();
    const alerts=state.timers.filter(t=>t.status==='finished'&&!t.acknowledged);
    el('timer-badge').hidden=!alerts.length||config?.timeToolsEnabled===false;el('timer-badge').textContent=alerts.length;
    el('open-time-tools').setAttribute('aria-label',alerts.length?`Open timers: ${alerts.length} finished`:'Open timers and stopwatch');
    if(alerts.length&&config?.timeToolsEnabled!==false&&now-lastBeep>10000){beep();lastBeep=now;el('tools-status').textContent=alerts.map(t=>t.name).join(', ')+': time is up';}
    else if(!alerts.length&&el('tools-status').textContent.endsWith('time is up'))el('tools-status').textContent='';
    if(dialog.open){
      if(view==='activities'&&focusedActivity){
        const remaining=Math.max(0,focusedActivity.at-now),fraction=T.hourFraction(remaining);
        el('activity-focus-remaining').textContent=T.durationText(Math.ceil(remaining/1000)*1000);
        el('activity-focus-state').textContent=remaining>3600000?'More than an hour':remaining?'Time remaining':'Time reached';
        el('activity-dial').style.setProperty('--pie-angle',(fraction*360).toFixed(3)+'deg');
        el('activity-dial').dataset.fraction=String(fraction);
        el('activity-pie').setAttribute('aria-valuenow',(fraction*60).toFixed(1));
      }
      el('stopwatch-time').textContent=T.durationText(T.elapsed(state.stopwatch,now),true);
      glyph(el('stopwatch-toggle'),state.stopwatch.startedAt===null?'play':'pause',state.stopwatch.startedAt===null?'Start stopwatch':'Pause stopwatch');
      el('stopwatch-lap').disabled=state.stopwatch.startedAt===null||state.stopwatch.laps.length>=100;
      if(view==='activities')for(const row of el('activity-timers').querySelectorAll('[data-at]')){
        const remaining=Math.max(0,Number(row.dataset.at)-now);row.querySelector('output').textContent=T.durationText(Math.ceil(remaining/1000)*1000);row.querySelector('progress').value=remaining;row.querySelector('.activity-state').textContent=remaining>3600000?'More than an hour':remaining?'Time remaining':'Time reached';row.dataset.reached=String(!remaining);
      }
    }
    glyph(el('timer-sound'),state.sound?'volume-2':'volume-x',state.sound?'Mute timer sound':'Enable timer sound');
  }
  el('add-timer').onclick=()=>{unlockSound();addTimer();};
  el('timer-sound').onclick=()=>{unlockSound();state.sound=!state.sound;save();tick();};
  el('stopwatch-toggle').onclick=()=>{const s=state.stopwatch,now=Date.now();if(s.startedAt===null)s.startedAt=now;else{s.elapsedMs=T.elapsed(s,now);s.startedAt=null;}save();tick();};
  el('stopwatch-reset').onclick=()=>{state.stopwatch={elapsedMs:0,startedAt:null,laps:[]};save();renderLaps();tick();};
  el('stopwatch-lap').onclick=()=>{if(state.stopwatch.startedAt!==null&&state.stopwatch.laps.length<100){state.stopwatch.laps.push(T.elapsed(state.stopwatch));save();renderLaps();}};
  el('close-time-tools').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{leaveActivityFocus(false);document.body.classList.remove('tools-mode');});
  el('open-time-tools').onclick=()=>open('timers');el('open-school').onclick=()=>{group='';open('activities');};
  for(const name of ['timers','stopwatch','activities'])el('tab-'+name).onclick=()=>showView(name);
  dialog.querySelector('.tools-tabs').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=[...dialog.querySelectorAll('[role=tab]')].filter(t=>!t.hidden),index=tabs.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();};
  el('activity-group').onchange=()=>{group=el('activity-group').value;renderActivities();tick();};
  for(const button of el('lunch-options').querySelectorAll('button'))button.onclick=()=>{variant=button.dataset.lunch;try{localStorage.setItem('kitchen-activity-lunch',variant);}catch{}renderActivities();tick();};
  renderTimers();renderLaps();setInterval(tick,100);setInterval(()=>{if(config)refreshOptions();},1000);
  window.KitchenTimeTools={open,refreshOptions};
})();
