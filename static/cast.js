(function(){
  const $=id=>document.getElementById(id),icons=()=>window.lucide?.createIcons();
  let clientId;
  try{clientId=localStorage.getItem('kitchen-cast-client');if(!/^[a-f0-9-]{36}$/.test(clientId||'')){clientId=crypto.randomUUID();localStorage.setItem('kitchen-cast-client',clientId);}}
  catch{clientId=crypto.randomUUID();}
  const picker=document.createElement('dialog');picker.id='cast-picker';picker.setAttribute('aria-labelledby','cast-heading');
  picker.innerHTML='<div class="dialog-heading"><h2 id="cast-heading">Cast timer</h2><button id="close-cast-picker" class="icon-button view-close" type="button" title="Close" aria-label="Close cast picker"><i data-lucide="x"></i></button></div><p id="cast-timer-name" class="cast-timer-name"></p><div class="cast-screen-picker"><label>Screen<select id="cast-screen"><option value="">Choose a screen</option></select></label><button id="refresh-cast-screens" class="icon-button" type="button" title="Refresh Cast screens" aria-label="Refresh Cast screens"><i data-lucide="refresh-cw"></i></button></div><p id="cast-status" class="account-status" role="status"></p><div class="cast-picker-actions"><button id="start-cast" class="primary" type="button" disabled><i data-lucide="cast"></i>Cast</button></div><div id="cast-sessions"></div>';
  document.body.append(picker);
  let selected=null,sessions=[],busy=false,polling=false,lastPoll=0;
  const fingerprints=new Map();
  async function request(path,body){
    const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Kitchen-Request':'1'},body:JSON.stringify(body)}:{});
    const value=await response.json();if(!response.ok)throw Error(value.error||'Cast request failed');return value;
  }
  function snapshot(source){return window.KitchenTimeTools?.castSnapshot(source)||null;}
  function payload(source){
    const timer=snapshot(source);if(!timer)throw Error('This timer is no longer available.');
    return {clientId,source,timer,theme:document.body.dataset.theme,paperTexture:config.paperTexture};
  }
  function fingerprint(value){const timer=value.timer;return JSON.stringify([timer.name,timer.status,timer.endAt,timer.startedAt,timer.status==='running'?null:timer.remainingMs,timer.status==='running'?null:timer.elapsedMs,timer.laps,value.theme,value.paperTexture]);}
  function renderSessions(){
    $('cast-sessions').replaceChildren();
    for(const session of sessions){
      const row=document.createElement('div');row.className='cast-session';
      const label=document.createElement('span');label.textContent=session.deviceName+(session.lastSeen?' · Connected':' · Waiting for screen');
      const stop=document.createElement('button');stop.className='icon-button';stop.type='button';stop.title='Stop sharing to '+session.deviceName;stop.setAttribute('aria-label',stop.title);stop.innerHTML='<i data-lucide="square"></i>';
      stop.onclick=async()=>{stop.disabled=true;try{await request('/api/cast/stop',{clientId,sessionId:session.id});sessions=sessions.filter(item=>item.id!==session.id);fingerprints.delete(session.id);renderSessions();$('cast-status').textContent='Timer sharing stopped.';}catch(error){$('cast-status').textContent=error.message;stop.disabled=false;}};
      row.append(label,stop);$('cast-sessions').append(row);
    }
    updateButtons();icons();
  }
  function updateButtons(){
    for(const button of document.querySelectorAll('.cast-source')){
      const active=sessions.some(s=>s.source.kind===button.dataset.castKind&&s.source.id===button.dataset.castId);
      button.dataset.casting=String(active);button.hidden=config?.castEnabled===false;
    }
  }
  async function devices(refresh=false){
    $('refresh-cast-screens').disabled=true;$('start-cast').disabled=true;$('cast-status').textContent='Looking for Cast screens...';
    try{
      const value=await request('/api/cast/devices',{refresh}),previous=$('cast-screen').value;
      $('cast-screen').replaceChildren(new Option('Choose a screen',''));
      for(const screen of value.devices)$('cast-screen').append(new Option(screen.name,screen.id));
      if(value.devices.some(d=>d.id===previous))$('cast-screen').value=previous;
      $('cast-status').textContent=value.devices.length?'':'No Cast screens found. Check the TV and LAN connection.';
      $('start-cast').disabled=!$('cast-screen').value;
    }catch(error){$('cast-status').textContent=error.message;}
    finally{$('refresh-cast-screens').disabled=false;}
  }
  async function open(source){
    if(!config||config.castEnabled===false)return;
    selected={...source};const value=snapshot(selected);if(!value)return;
    $('cast-timer-name').textContent=value.name;renderSessions();picker.showModal();$('close-cast-picker').focus();
    await devices();
  }
  function button(source){
    const element=document.createElement('button');element.type='button';element.className='icon-button cast-source';
    element.dataset.castKind=source.kind;element.dataset.castId=source.id;element.title='Cast this timer';element.setAttribute('aria-label',element.title);element.hidden=config?.castEnabled===false;
    element.innerHTML='<i data-lucide="cast"></i>';element.onclick=event=>{event.stopPropagation();open(source);};return element;
  }
  $('cast-screen').onchange=()=>$('start-cast').disabled=!$('cast-screen').value||busy;
  $('refresh-cast-screens').onclick=()=>devices(true);
  $('close-cast-picker').onclick=()=>picker.close();
  $('start-cast').onclick=async()=>{
    if(!selected||!$('cast-screen').value||busy)return;
    busy=true;$('start-cast').disabled=true;$('cast-status').textContent='Connecting to screen...';
    try{
      const data=payload(selected),job=await request('/api/cast/start',{...data,deviceId:$('cast-screen').value});
      sessions=sessions.filter(item=>item.deviceName!==job.deviceName);sessions.push(job);fingerprints.set(job.id,fingerprint(data));
      $('cast-status').textContent='Timer sent. Waiting for the screen to connect.';renderSessions();
    }catch(error){$('cast-status').textContent=error.message;}
    finally{busy=false;$('start-cast').disabled=!$('cast-screen').value;}
  };
  async function sync(){
    if(!window.KitchenTimeTools||!config||config.castEnabled===false||polling||busy)return;
    polling=true;
    try{
      if(Date.now()-lastPoll>2500){const value=await request('/api/cast/state?client='+encodeURIComponent(clientId));sessions=value.sessions||[];lastPoll=Date.now();if(picker.open)renderSessions();else updateButtons();}
      for(const session of sessions){
        const current=snapshot(session.source);
        if(!current){await request('/api/cast/stop',{clientId,sessionId:session.id});sessions=sessions.filter(item=>item.id!==session.id);continue;}
        const data=payload(session.source),key=fingerprint(data);
        if(fingerprints.get(session.id)!==key){await request('/api/cast/update',{...data,sessionId:session.id});fingerprints.set(session.id,key);}
      }
    }catch(error){if(picker.open)$('cast-status').textContent=error.message;}
    finally{polling=false;}
  }
  window.KitchenCast={open,button};setInterval(sync,1000);icons();
})();
