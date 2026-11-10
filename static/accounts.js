(()=>{
  const byId=id=>document.getElementById(id);
  let apps, selectedAccount;
  const make=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  async function read(url){const response=await fetch(url);const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
  async function post(url,body){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Kitchen-Request':'1'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
  function providerStatus(){
    if(!apps)return;
    const provider=byId('account-provider').value;
    byId('account-status').textContent=apps[provider].configured?'':'One-time provider app setup is required before sign-in.';
  }
  async function refreshAccounts(){
    apps=await read('/api/oauth/config');
    for(const provider of ['google','microsoft']){
      byId(`${provider}-client-id`).value=apps[provider].clientId;
      byId(`${provider}-client-secret`).value='';
      byId(`${provider}-client-secret`).placeholder=apps[provider].hasSecret?'Saved — leave blank to keep':'';
    }
    const accounts=await read('/api/accounts');byId('connected-accounts').replaceChildren();
    if(!accounts.length)byId('connected-accounts').append(make('p','account-status','No accounts connected'));
    for(const account of accounts){
      const row=make('div','account-row');const identity=make('div');
      identity.append(make('strong','',account.email||account.name),make('span','account-provider-label',account.provider==='google'?'Google':'Microsoft 365 / Outlook'));
      const choose=make('button','secondary','Select calendars');choose.type='button';choose.onclick=()=>openPicker(account.id);
      const remove=make('button','icon-button');remove.type='button';remove.title='Disconnect account';remove.setAttribute('aria-label',`Disconnect ${account.email||account.name}`);remove.innerHTML='<i data-lucide="trash-2"></i>';
      remove.onclick=async()=>{remove.disabled=true;try{await post('/api/accounts/remove',{accountId:account.id});await refreshAccounts();await load();}catch(e){byId('account-status').textContent=e.message;remove.disabled=false;}};
      row.append(identity,choose,remove);byId('connected-accounts').append(row);
    }
    providerStatus();window.lucide?.createIcons();
  }
  async function openPicker(id){
    selectedAccount=id;byId('available-calendars').replaceChildren();byId('picker-status').textContent='Loading calendars…';byId('save-selection').disabled=true;byId('calendar-picker').showModal();
    try{
      const [calendars,settings]=await Promise.all([read(`/api/accounts/calendars?id=${encodeURIComponent(id)}`),read('/api/settings')]);
      const enabled=new Set(settings.calendars.filter(c=>c.accountId===id).map(c=>c.calendarId));
      for(const calendar of calendars){
        const label=make('label','picker-calendar');const check=make('input');check.type='checkbox';check.value=calendar.id;check.checked=enabled.has(calendar.id);
        label.append(check,make('span','',calendar.name));byId('available-calendars').append(label);
      }
      byId('picker-status').textContent=calendars.length?'':'No calendars available';byId('save-selection').disabled=false;
    }catch(e){byId('picker-status').textContent=e.message;}
  }
  byId('account-provider').onchange=providerStatus;
  byId('connect-account').onclick=async()=>{
    const provider=byId('account-provider').value;
    if(!apps?.[provider]?.configured){byId('provider-setup').open=true;providerStatus();return;}
    byId('connect-account').disabled=true;
    try{const data=await post('/api/accounts/connect',{provider,hint:byId('account-hint').value});window.location.assign(data.url);}
    catch(e){byId('account-status').textContent=e.message;byId('connect-account').disabled=false;}
  };
  byId('save-providers').onclick=async()=>{
    byId('save-providers').disabled=true;
    try{const body={};for(const p of ['google','microsoft'])body[p]={clientId:byId(`${p}-client-id`).value,clientSecret:byId(`${p}-client-secret`).value};await post('/api/oauth/config',body);await refreshAccounts();byId('account-status').textContent='Provider setup saved';}
    catch(e){byId('account-status').textContent=e.message;}
    finally{byId('save-providers').disabled=false;}
  };
  byId('close-picker').onclick=()=>byId('calendar-picker').close();
  byId('save-selection').onclick=async()=>{
    byId('save-selection').disabled=true;
    try{const selected=Array.from(byId('available-calendars').querySelectorAll('input:checked')).map(c=>c.value);await post('/api/accounts/select',{accountId:selectedAccount,selected});await load();byId('calendar-picker').close();byId('account-status').textContent='Calendar selection saved';}
    catch(e){byId('picker-status').textContent=e.message;}
    finally{byId('save-selection').disabled=false;}
  };
  refreshAccounts().then(()=>{
    const query=new URLSearchParams(location.search);
    if(query.get('auth')==='failed')byId('account-status').textContent='Sign-in was cancelled or failed. Check the provider registration and try again.';
    if(query.get('auth')==='connected')byId('account-status').textContent='Account connected. Select its calendars below.';
    if(query.has('auth'))history.replaceState({},'',location.pathname);
  }).catch(e=>byId('account-status').textContent=e.message);
})();
