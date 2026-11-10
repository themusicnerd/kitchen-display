let config;
const $=id=>document.getElementById(id);
const icons=()=>window.lucide?.createIcons();
const keys=['title','timezone','upcomingWeeks','weekHeight','fontWeight','theme','cameraFit','showCamera','hidePrivateEvents','nightEnabled','nightStart','nightEnd','nightBrightness','paperTexture'];
const binaryKeys=new Set(['showCamera','hidePrivateEvents','nightEnabled','paperTexture']);
const calendarIcons=[['calendar-days','Calendar'],['user-round','Person'],['users-round','Family'],['briefcase-business','Work'],['house','Home'],['graduation-cap','School'],['heart','Care'],['stethoscope','Medical'],['party-popper','Celebration'],['plane','Travel'],['dumbbell','Exercise'],['music','Music'],['utensils','Meals'],['car','Car'],['baby','Child'],['clapperboard','Production'],['wrench','Maintenance'],['sun','Holiday']];
let iconTarget;
function applyRowIcon(row,name){
  row.dataset.icon=name;
  const button=row.querySelector('.choose-icon');button.replaceChildren();
  const glyph=document.createElement('i');glyph.dataset.lucide=name;button.append(glyph);
  button.title=`Change icon: ${calendarIcons.find(i=>i[0]===name)?.[1]||'Calendar'}`;
  icons();
}
function openIconPicker(row){
  iconTarget=row;$('icon-options').replaceChildren();
  for(const [name,label] of calendarIcons){
    const button=document.createElement('button');button.type='button';button.className='icon-choice';
    button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(name===row.dataset.icon));
    const icon=document.createElement('i');icon.dataset.lucide=name;button.append(icon);
    button.onclick=()=>{applyRowIcon(row,name);$('icon-picker').close();row.querySelector('.choose-icon').focus();$('save-status').textContent='Icon changed. Save to apply.';};
    $('icon-options').append(button);
  }
  icons();$('icon-picker').showModal();
}
$('close-icon-picker').onclick=()=>$('icon-picker').close();
function calendarRow(source){
  const row=document.createElement('div');row.className='calendar-source';row.dataset.id=source.id;row.dataset.configured=source.configured?'true':'false';
  row.dataset.accountId=source.accountId||'';row.dataset.calendarId=source.calendarId||'';
  row.innerHTML='<label class="checkbox"><input type="checkbox" class="enabled">Enabled</label><label>Name<input class="name" maxlength="60" required></label><label>Icon<button type="button" class="icon-button choose-icon" aria-label="Choose calendar icon"></button></label><label>Colour<input class="color" type="color"></label><button type="button" class="icon-button remove" title="Remove calendar" aria-label="Remove calendar"><i data-lucide="trash-2"></i></button><label class="feed-label">Private iCalendar feed URL<input class="feed" type="password" autocomplete="off" spellcheck="false"></label>';
  row.querySelector('.enabled').checked=source.enabled;
  row.querySelector('.name').value=source.name;
  row.querySelector('.color').value=source.color;
  row.querySelector('.feed').placeholder=source.configured?'Connected — leave blank to keep saved URL':'https://…';
  const label=row.querySelector('.feed-label');
  const provider=source.provider==='google'?'Google Calendar':source.provider==='microsoft'?'Microsoft Calendar':'Calendar';
  label.firstChild.textContent=`${provider} · ${source.configured?'Connected':'Not connected'} · Private iCalendar feed URL`;
  if(source.accountId){label.firstChild.textContent=`${provider} · ${source.accountLabel||'Connected through sign-in'}`;row.querySelector('.feed').hidden=true;}
  row.querySelector('.choose-icon').onclick=()=>openIconPicker(row);
  row.querySelector('.remove').onclick=()=>{row.remove();$('save-status').textContent='Calendar removed from form. Save to apply.';};
  $('calendar-sources').append(row);applyRowIcon(row,source.icon||'calendar-days');icons();
}
function sliders(){for(const id of ['weekHeight','fontWeight','nightBrightness'])$(id+'-value').textContent=$(id).value+(id==='fontWeight'?'':id==='nightBrightness'?'%':' px');}
async function load(){
  const response=await fetch('/api/settings');if(!response.ok)throw Error('Unable to load settings');config=await response.json();
  document.body.dataset.theme=config.theme;
  document.body.dataset.paper=String(config.paperTexture);
  for(const key of keys){if(binaryKeys.has(key))$(key).checked=config[key];else $(key).value=config[key];}
  $('calendar-sources').replaceChildren();config.calendars.forEach(calendarRow);sliders();icons();
}
$('settings-form').onsubmit=e=>e.preventDefault();
for(const id of ['weekHeight','fontWeight','nightBrightness'])$(id).oninput=sliders;
$('theme').onchange=()=>document.body.dataset.theme=$('theme').value;
$('paperTexture').onchange=()=>document.body.dataset.paper=String($('paperTexture').checked);
$('add-calendar').onclick=()=>{calendarRow({id:crypto.randomUUID(),name:'',color:['#d99a62','#d88691','#e3bb6e','#b49ac9'][document.querySelectorAll('.calendar-source').length%4],enabled:true});};
$('save').onclick=async()=>{
  for(const control of $('settings-form').elements)if(!control.closest('.camera-source')&&!control.reportValidity())return;
  const payload={revision:config.revision};for(const key of keys)payload[key]=binaryKeys.has(key)?$(key).checked:$(key).value;
  payload.calendars=Array.from(document.querySelectorAll('.calendar-source')).map(row=>({id:row.dataset.id,name:row.querySelector('.name').value,color:row.querySelector('.color').value,icon:row.dataset.icon,enabled:row.querySelector('.enabled').checked,url:row.querySelector('.feed').value,configured:row.dataset.configured==='true',accountId:row.dataset.accountId,calendarId:row.dataset.calendarId}));
  $('save').disabled=true;$('save-status').textContent='Saving…';
  try{const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Kitchen-Request':'1'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error);await load();$('save-status').textContent='Saved';}
  catch(error){$('save-status').textContent=error.message||'Unable to save settings';}
  finally{$('save').disabled=false;}
};
load().catch(error=>$('save-status').textContent=error.message);

let cameraConfig;
function cameraRow(camera){
  const row=document.createElement('div');row.className='camera-source';row.dataset.id=camera.id;
  row.innerHTML='<label class="checkbox"><input class="camera-enabled" type="checkbox">Enabled</label><label>Name<input class="camera-name" maxlength="60" required></label><button type="button" class="icon-button camera-remove" title="Remove camera" aria-label="Remove camera"><i data-lucide="trash-2"></i></button><label>IP address or hostname<input class="camera-host" required autocomplete="off" spellcheck="false"></label><label>RTSP port<input class="camera-port" type="number" min="1" max="65535" required></label><label class="camera-path-label">RTSP path<input class="camera-path" autocomplete="off" spellcheck="false"></label><label>Username<input class="camera-user" autocomplete="off"></label><label>Password<input class="camera-password" type="password" autocomplete="new-password"></label><label class="checkbox"><input class="camera-clear-password" type="checkbox">Clear saved password</label>';
  for(const [key,selector] of [['name','name'],['host','host'],['port','port'],['path','path'],['username','user']])row.querySelector('.camera-'+selector).value=camera[key]??'';
  row.querySelector('.camera-enabled').checked=camera.enabled!==false;
  row.querySelector('.camera-password').placeholder=camera.hasPassword?'Saved; leave blank to keep':'Camera password';
  row.querySelector('.camera-path').placeholder=camera.pathConfigured?'Saved; leave blank to keep':'/Streaming/Channels/102';
  row.querySelector('.camera-path').required=!camera.pathConfigured;
  row.querySelector('.camera-remove').onclick=()=>{row.remove();$('camera-settings-status').textContent='Camera removed from form. Apply camera connections to save.';};
  $('camera-sources').append(row);icons();
}
async function loadCameras(){
  const response=await fetch('/api/cameras');const result=await response.json();
  if(!response.ok)throw Error(result.error||'Camera settings unavailable');
  cameraConfig=result;$('camera-sources').replaceChildren();result.cameras.forEach(cameraRow);
}
$('add-camera').onclick=()=>{
  if(!cameraConfig)return;
  if(document.querySelectorAll('.camera-source').length>=4){$('camera-settings-status').textContent='Maximum four cameras.';return;}
  cameraRow({id:crypto.randomUUID(),name:'Camera',host:'',port:554,path:'/Streaming/Channels/102',username:'',enabled:true});
};
$('save-cameras').onclick=async()=>{
  if(!cameraConfig)return;
  const rows=Array.from(document.querySelectorAll('.camera-source'));
  for(const row of rows)for(const input of row.querySelectorAll('input'))if(!input.reportValidity())return;
  const cameras=rows.map(row=>({id:row.dataset.id,name:row.querySelector('.camera-name').value,host:row.querySelector('.camera-host').value,port:row.querySelector('.camera-port').value,path:row.querySelector('.camera-path').value,username:row.querySelector('.camera-user').value,password:row.querySelector('.camera-password').value,clearPassword:row.querySelector('.camera-clear-password').checked,enabled:row.querySelector('.camera-enabled').checked}));
  $('save-cameras').disabled=true;$('camera-settings-status').textContent='Applying connections...';
  try{
    const response=await fetch('/api/cameras',{method:'POST',headers:{'Content-Type':'application/json','X-Kitchen-Request':'1'},body:JSON.stringify({revision:cameraConfig.revision,cameras})});const result=await response.json();
    if(!response.ok)throw Error(result.error||'Unable to apply cameras');
    await loadCameras();$('camera-settings-status').textContent='Camera connections saved. Streams are reconnecting.';
  }catch(error){$('camera-settings-status').textContent=error.message;}
  finally{$('save-cameras').disabled=false;}
};
loadCameras().catch(error=>{$('camera-settings-status').textContent=error.message;$('add-camera').disabled=true;$('save-cameras').disabled=true;});
const preview=document.createElement('div');preview.className='night-dimmer';preview.setAttribute('aria-hidden','true');document.body.append(preview);
let previewTimer;
$('preview-night').onclick=()=>{clearTimeout(previewTimer);preview.style.opacity=String(1-Number($('nightBrightness').value)/100);previewTimer=setTimeout(()=>preview.style.opacity='0',4000);};
