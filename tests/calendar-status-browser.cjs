const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
  const options={headless:true,hasTouch:true,viewport:{width:1080,height:1920}};
  if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
  const browser=await chromium.launchPersistentContext(process.env.CHROMIUM_PROFILE||fs.mkdtempSync(path.join(os.tmpdir(),'calendar-links-')),options);
  const base=process.env.TEST_URL||'http://127.0.0.1:8090',accounts=[{id:'google-account',email:'family@example.com',name:'Family',provider:'google'},{id:'m365-account',email:'work@example.com',name:'Work',provider:'microsoft'}];
  const config={revision:'fixture',title:'Calendar',timezone:'Australia/Sydney',upcomingWeeks:3,weekHeight:640,fontWeight:460,theme:'dark',paperTexture:false,cameraFit:'contain',showCamera:false,hidePrivateEvents:true,nightEnabled:false,nightStart:'22:00',nightEnd:'06:30',nightBrightness:25,timeToolsEnabled:true,visualTimersEnabled:true,castEnabled:true,castBaseUrl:'',castKnownHosts:[],visualTimers:[],calendars:accounts.map((a,i)=>({id:'calendar-'+i,accountId:a.id,calendarId:'selected-'+i,provider:a.provider,accountLabel:a.email,name:i?'Office':'Family',enabled:true,color:'#d99a62',icon:'calendar-days',configured:true})),cameras:[]};
  let sources=[{id:'calendar-0',accountId:accounts[0].id,state:'offline - cached events',issue:'auth',lastSuccess:Date.now()/1000-86400},{id:'calendar-1',accountId:accounts[1].id,state:'ready',lastSuccess:Date.now()/1000}];
  const reconnects=[];let retries=0;
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
  try{
    await browser.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.pathname==='/api/settings')return route.fulfill({json:config});
      if(url.pathname==='/api/cameras')return route.fulfill({json:{revision:'fixture',cameras:[]}});
      if(url.pathname==='/api/accounts')return route.fulfill({json:accounts});
      if(url.pathname==='/api/oauth/config')return route.fulfill({json:{google:{clientId:'fixture',configured:true},microsoft:{clientId:'fixture',configured:true}}});
      if(url.pathname==='/api/calendar-status')return route.fulfill({json:{sources,updated:Date.now()/1000}});
      if(url.pathname==='/api/events')return route.fulfill({json:{events:[],sources:sources.map((s,i)=>({...s,name:config.calendars[i].name})),updated:Date.now()/1000}});
      if(url.pathname==='/api/accounts/connect'){reconnects.push(req.postDataJSON());return route.fulfill({status:400,json:{error:'Fixture sign-in requested'}});}
      if(url.pathname==='/api/refresh'){retries++;return route.fulfill({json:{ok:true}});}
      return route.fulfill({json:{ok:true}});
    });
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/settings');
    await page.locator('.account-row[data-account-id="google-account"] .calendar-link-status').filter({hasText:'Sign-in required'}).waitFor();
    assert.match(await page.locator('.account-row[data-account-id="m365-account"] .calendar-link-status').textContent(),/Connected.*Last synced/);
    assert.match(await page.locator('.calendar-source[data-id="calendar-0"] .calendar-link-status').textContent(),/cached events/);
    const edited=page.locator('.calendar-source[data-id="calendar-0"] .name');await edited.fill('My custom name');
    await page.locator('.account-row[data-account-id="google-account"] .reconnect-account').tap();
    await page.locator('#account-status').filter({hasText:'Fixture sign-in requested'}).waitFor();
    assert.deepEqual(reconnects[0],{accountId:'google-account'});assert.match(await page.locator('#account-status').textContent(),/sign-in requested/);
    await page.locator('.calendar-source[data-id="calendar-1"] .calendar-reconnect').tap();
    for(let i=0;i<50&&reconnects.length<2;i++)await page.waitForTimeout(100);
    assert.deepEqual(reconnects[1],{accountId:'m365-account'});
    sources=sources.map(s=>({...s,state:'ready',issue:undefined,lastSuccess:Date.now()/1000}));
    await page.locator('.account-row [aria-label="Retry calendar sync"]').first().tap();
    for(let i=0;i<100&&!await page.locator('.account-row[data-account-id="google-account"] .calendar-link-status').textContent().then(s=>s.startsWith('Connected'));i++)await page.waitForTimeout(100);
    assert(retries>0);assert.match(await page.locator('.account-row[data-account-id="google-account"] .calendar-link-status').textContent(),/^Connected/);
    assert.equal(await edited.inputValue(),'My custom name','Status polling never overwrites unsaved edits');
    for(const size of [{width:1080,height:1920},{width:390,height:844},{width:320,height:720}]){
      await page.setViewportSize(size);await page.locator('#connected-accounts').scrollIntoViewIfNeeded();
      const fits=await page.locator('#connected-accounts button').evaluateAll(buttons=>buttons.every(b=>{const r=b.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;}));assert(fits,'Account buttons stay within touch viewport');
      await page.screenshot({path:path.join(__dirname,`../test-results/calendar-status-${size.width}.png`)});
    }
    sources[0]={...sources[0],state:'offline - cached events',issue:'auth'};
    await page.goto(base);await page.locator('#legend .connection-dot[data-level=error]').waitFor();
    assert.match(await page.locator('#connection-state').textContent(),/Sign-in required/);assert.equal(await page.locator('.connection-settings').getAttribute('href'),'/settings#connected-accounts');
    assert.deepEqual(errors,[]);console.log('PASS: account/calendar connection states, reconnect identity, retry sync, last success, edit preservation, main status dots and touch layout.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
