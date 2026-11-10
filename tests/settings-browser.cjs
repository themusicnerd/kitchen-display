const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
async function waitUntil(page,predicate){
  for(let attempt=0;attempt<100;attempt++){if(await page.evaluate(predicate))return;await page.waitForTimeout(100);}
  throw Error('Timed out waiting for UI');
}
async function expectPaperOpacity(page,expected){
  for(let attempt=0;attempt<100;attempt++){
    const actual=Number(await page.evaluate(()=>getComputedStyle(document.body,'::before').opacity));
    if(Math.abs(actual-expected)<.001)return;
    await page.waitForTimeout(100);
  }
  assert.fail(`Paper texture did not reach opacity ${expected}`);
}

(async()=>{
  const options={headless:true,viewport:{width:1080,height:1920}};
  if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
  const profile=process.env.CHROMIUM_PROFILE||fs.mkdtempSync(path.join(os.tmpdir(),'kitchen-ui-'));
  const browser=await chromium.launchPersistentContext(profile,options);
  const base=process.env.TEST_URL||'http://127.0.0.1:8090';
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
  const config={revision:'fixture',title:'Family calendar',timezone:'Australia/Sydney',upcomingWeeks:3,weekHeight:640,fontWeight:460,cameraHeight:230,theme:'dark',paperTexture:true,cameraFit:'contain',showCamera:true,hidePrivateEvents:true,nightEnabled:true,nightStart:'22:00',nightEnd:'18:30',nightBrightness:25,timeToolsEnabled:true,visualTimersEnabled:true,visualTimers:[],calendars:[],cameras:[]};
  let cameraPayload;
  let fixtureEvents=[];
  let cameraState={revision:'camera-fixture',cameras:[{id:'example',name:'Front camera',host:'camera.example',port:554,path:'/Streaming/Channels/102',enabled:true,username:'viewer',hasPassword:true,pathConfigured:true}]};
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    // No real account, calendar, camera or settings writes during the UI test.
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),request=route.request();
      if(url.pathname==='/api/settings'){
        if(request.method()==='POST')Object.assign(config,request.postDataJSON());
        return route.fulfill({json:config});
      }
      if(url.pathname==='/api/cameras'){
        if(request.method()==='POST'){
          cameraPayload=request.postDataJSON();
          cameraState={revision:'next',cameras:cameraPayload.cameras.map(({password,clearPassword,...c})=>({...c,hasPassword:!!password||!clearPassword,pathConfigured:true}))};
        }
        return route.fulfill({json:cameraState});
      }
      if(url.pathname==='/api/events')return route.fulfill({json:{events:fixtureEvents,sources:[],updated:null}});
      if(url.pathname==='/api/accounts')return route.fulfill({json:[]});
      if(url.pathname==='/api/oauth/config')return route.fulfill({json:{google:{clientId:'',configured:false},microsoft:{clientId:'',configured:false}}});
      return route.fulfill({json:{ok:true}});
    });
    await page.goto(base+'/settings');await page.waitForSelector('.camera-source');
    assert(await page.locator('#paperTexture').isChecked());
    await page.locator('#theme').selectOption('light');await page.waitForTimeout(800);
    assert.equal(await page.locator('body').getAttribute('data-theme'),'light');
    await expectPaperOpacity(page,1);
    await page.locator('#paperTexture').uncheck();await page.waitForTimeout(800);
    await expectPaperOpacity(page,0);
    await page.locator('#paperTexture').check();await page.locator('#theme').selectOption('dark');
    assert.equal(await page.locator('.camera-password').inputValue(),'');
    assert.match(await page.locator('.camera-password').getAttribute('placeholder'),/Saved/);
    await page.locator('.camera-name').fill('Patio');
    await page.locator('#save-cameras').click();await waitUntil(page,()=>document.getElementById('camera-settings-status').textContent.includes('saved'));
    assert.equal(cameraPayload.cameras[0].name,'Patio');assert.equal(cameraPayload.cameras[0].password,'');
    await page.locator('#add-camera').click();assert.equal(await page.locator('.camera-source').count(),2);
    await page.locator('.camera-remove').last().click();assert.equal(await page.locator('.camera-source').count(),1);
    await page.locator('#nightEnd').fill('06:30');
    await page.locator('#nightBrightness').fill('30');await page.locator('#nightBrightness').dispatchEvent('input');
    assert.equal(await page.locator('#nightBrightness-value').textContent(),'30%');
    await page.locator('#preview-night').click();await page.waitForTimeout(1400);
    assert(Math.abs(Number(await page.locator('.night-dimmer').evaluate(el=>getComputedStyle(el).opacity))-.7)<.02);
    assert.equal(await page.locator('.night-dimmer').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
    await page.locator('#save').click();await waitUntil(page,()=>document.getElementById('save-status').textContent==='Saved');
    assert.equal(config.nightEnd,'06:30');assert.equal(Number(config.nightBrightness),30);
    await page.waitForTimeout(4200);
    for(const [width,height,name] of [[1080,1920,'settings-portrait'],[390,844,'settings-mobile'],[1440,900,'settings-desktop']]){
      await page.setViewportSize({width,height});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);
      const valid=await page.locator('.camera-source input').evaluateAll(inputs=>inputs.every(el=>el.getBoundingClientRect().right<=innerWidth));assert(valid,name+' camera fields fit');
      await page.screenshot({path:path.join(__dirname,`../test-results/${name}.png`),fullPage:true});
    }
    config.calendars=[{id:'family',name:'Family',color:'#d99a62',icon:'users-round',enabled:true,configured:true},{id:'work',name:'Work',color:'#71b3db',icon:'briefcase-business',enabled:true,configured:true}];
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const dayKey=offset=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
    fixtureEvents=config.calendars.flatMap(source=>[0,7].map(offset=>({id:source.id+offset,sourceId:source.id,source:source.name,color:source.color,title:source.name+(offset?' next week':' today'),allDay:true,start:dayKey(offset),end:dayKey(offset+1)})));
    await page.goto(base+'/');await waitUntil(page,()=>document.getElementById('clock').textContent.length>0);
    await page.evaluate(()=>{localStorage.removeItem('kitchen-hidden-calendars');localStorage.removeItem('kitchen-theme');hiddenCalendars=readHiddenCalendars();render();});
    assert.equal(await page.locator('#week .event').count(),2);
    assert.equal(await page.locator('#upcoming .event').count(),2);
    await page.locator('[data-calendar-id=family]').click();await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-calendar-id=family]').getAttribute('aria-pressed'),'false');
    assert.equal(Number(await page.locator('[data-calendar-id=family]').evaluate(el=>getComputedStyle(el).opacity)),.35);
    assert.equal(await page.locator('#week .event').count(),1);
    assert.equal(await page.locator('#upcoming .event').count(),1);
    await page.locator('#week .today .day-heading').click();
    assert.equal(await page.locator('.detail-event').count(),1);
    assert.match(await page.locator('.detail-event h3').textContent(),/Work/);
    await page.locator('#close-details').click();
    await page.locator('[data-calendar-id=family]').click();
    assert.equal(await page.locator('#week .event').count(),2);
    await page.locator('[data-calendar-id=family]').focus();await page.keyboard.press('Space');
    assert.equal(await page.locator('[data-calendar-id=family]').getAttribute('aria-pressed'),'false');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.calendarId),'family','Legend keyboard focus retained');
    await page.locator('#hide-calendars').click();
    assert.equal(await page.locator('#week .event, #upcoming .event').count(),0);
    assert.equal(await page.locator('#legend button[aria-pressed=false]').count(),2);
    await page.reload();await waitUntil(page,()=>document.querySelectorAll('#legend button[aria-pressed=false]').length===2);
    assert.equal(await page.locator('#week .event, #upcoming .event').count(),0,'Hidden calendars survive reload');
    await page.locator('#show-calendars').click();
    assert.equal(await page.locator('#week .event').count(),2);
    assert.equal(await page.locator('#upcoming .event').count(),2);
    await page.locator('#upcoming').evaluate(el=>el.scrollTop=1000);
    const scroll=await page.locator('#upcoming').evaluate(el=>el.scrollTop);
    await page.waitForTimeout(100);const month=await page.locator('#month-label').textContent();
    await page.locator('[data-calendar-id=family]').click();
    assert.equal(await page.locator('#upcoming').evaluate(el=>el.scrollTop),scroll,'Filters retain upcoming scroll position');
    assert.equal(await page.locator('#month-label').textContent(),month,'Visible month retained after filtering');
    await page.locator('#show-calendars').click();
    await page.evaluate(()=>{config.title='';render();});
    assert(await page.locator('#title').isHidden(),'Optional heading may be empty');
    assert.equal(await page.locator('#week .day').count(),7,'Empty heading keeps the calendar');
    await page.locator('#theme-toggle').click();await page.waitForTimeout(800);
    assert.equal(await page.locator('body').getAttribute('data-theme'),'light');
    await expectPaperOpacity(page,1);
    assert(await page.evaluate(()=>getComputedStyle(document.body,'::before').backgroundImage.includes('paper-texture.png')));
    const textureResponse=await page.request.get(base+'/assets/paper-texture.png');assert(textureResponse.ok(),'Paper texture is locally served');
    const texture=await page.evaluate(async()=>{const image=new Image();image.src='/assets/paper-texture.png';await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};});assert(texture.width>0&&texture.height>0);
    await page.setViewportSize({width:1080,height:1920});
    await page.screenshot({path:path.join(__dirname,'../test-results/light-paper-portrait.png'),fullPage:true});
    await page.reload();await waitUntil(page,()=>document.body.dataset.theme==='light');
    await page.evaluate(()=>{config.paperTexture=false;render();});await page.waitForTimeout(800);
    await expectPaperOpacity(page,0);
    await page.evaluate(()=>{config.paperTexture=true;render();});
    await page.locator('#theme-toggle').click();await page.waitForTimeout(800);
    assert.equal(await page.locator('body').getAttribute('data-theme'),'dark');
    await expectPaperOpacity(page,0);
    await page.evaluate(()=>{config.nightStart='00:00';config.nightEnd='23:59';config.nightBrightness=25;updateNightMode();});
    await page.waitForTimeout(1400);assert.equal(await page.locator('body').getAttribute('data-night'),'true');
    assert.equal(Number(await page.locator('.night-dimmer').evaluate(el=>getComputedStyle(el).opacity)),.75);
    await page.evaluate(()=>{config.nightEnabled=false;updateNightMode();});await page.waitForTimeout(1400);
    assert.equal(Number(await page.locator('.night-dimmer').evaluate(el=>getComputedStyle(el).opacity)),0);
    config.nightEnabled=false;config.nightStart='00:00';config.nightEnd='23:59';
    await page.locator('#night-toggle').click();await page.waitForTimeout(1400);
    assert.equal(await page.locator('body').getAttribute('data-night-mode'),'on','Force on overrides a disabled schedule');
    assert.equal(Number(await page.locator('.night-dimmer').evaluate(el=>getComputedStyle(el).opacity)),.75);
    assert.equal(await page.locator('#night-toggle').getAttribute('aria-label'),'Turn night mode off');
    await page.reload();await waitUntil(page,()=>document.body.dataset.nightMode==='on');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kitchen-night-mode')).mode),'on','Override survives reload');
    config.nightEnabled=true;config.nightStart='00:00';config.nightEnd='23:59';
    await page.evaluate(()=>{config.nightEnabled=true;config.nightStart='00:00';config.nightEnd='23:59';updateNightMode();});
    await page.locator('#night-toggle').click();
    await page.waitForTimeout(1400);
    assert.equal(await page.locator('body').getAttribute('data-night'),'false','Force off beats scheduled night');
    assert.equal(await page.locator('body').getAttribute('data-night-mode'),'off');
    assert.equal(Number(await page.locator('.night-dimmer').evaluate(el=>getComputedStyle(el).opacity)),0);
    await page.reload();await waitUntil(page,()=>document.body.dataset.nightMode==='off');
    await page.evaluate(()=>{config.nightEnabled=true;config.nightStart='00:00';config.nightEnd='23:59';updateNightMode();});
    await page.locator('#night-auto').click();await page.waitForTimeout(1400);
    assert.equal(await page.locator('body').getAttribute('data-night-mode'),'auto');
    assert.equal(await page.locator('body').getAttribute('data-night'),'true','Clock resumes schedule');
    assert(await page.locator('#night-auto').isDisabled());
    await page.evaluate(()=>{config.nightEnabled=false;updateNightMode();});await page.waitForTimeout(1400);
    for(const [width,height,name] of [[1080,1920,'night-controls-portrait'],[390,844,'night-controls-mobile'],[320,720,'night-controls-small'],[1440,900,'night-controls-desktop']]){
      await page.setViewportSize({width,height});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);
      const controls=await page.locator('.night-controls button').evaluateAll(items=>items.map(button=>{const r=button.getBoundingClientRect();return r.width===44&&r.height===44&&r.x>=0&&r.right<=innerWidth;}));
      assert(controls.every(Boolean),name+' touch controls fit');
      await page.screenshot({path:path.join(__dirname,`../test-results/${name}.png`),fullPage:true});
    }
    await page.evaluate(()=>{localStorage.setItem('kitchen-night-mode','on');window.dispatchEvent(new StorageEvent('storage',{key:'kitchen-night-mode'}));});
    assert.equal(await page.locator('body').getAttribute('data-night-mode'),'on','Other tabs synchronise');
    await page.locator('#night-auto').click();
    await page.evaluate(()=>{Object.defineProperty(window,'localStorage',{configurable:true,get(){throw Error('Storage unavailable');}});});
    await page.locator('#night-toggle').click();
    assert.equal(await page.locator('body').getAttribute('data-night'),'true','Manual control still works if browser storage is blocked');
    await page.locator('#night-auto').click();
    assert.deepEqual(errors,[]);
    console.log('PASS: camera settings; calendar filters/fade/show-hide-all/persistence; blank heading; theme toggle/paper/plain/fade; night overrides and responsive touch controls');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
