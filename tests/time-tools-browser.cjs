const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
async function until(page,predicate){for(let i=0;i<150;i++){if(await page.evaluate(predicate))return;await page.waitForTimeout(100);}throw Error('Timed out waiting for UI');}
(async()=>{
  const options={headless:true,viewport:{width:1080,height:1920}};
  if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
  const browser=await chromium.launchPersistentContext(process.env.CHROMIUM_PROFILE||fs.mkdtempSync(path.join(os.tmpdir(),'kitchen-clocks-')),options);
  const base=process.env.TEST_URL||'http://127.0.0.1:8090';
  const config={revision:'fixture',title:'Clock tests',timezone:'Australia/Sydney',upcomingWeeks:3,weekHeight:640,fontWeight:460,cameraHeight:230,theme:'dark',paperTexture:true,cameraFit:'contain',showCamera:false,hidePrivateEvents:true,nightEnabled:true,nightStart:'00:00',nightEnd:'23:59',nightBrightness:25,timeToolsEnabled:true,visualTimersEnabled:true,visualTimers:[
    {id:'a',name:'First activity',group:'Activities',enabled:true,days:[0,1,2,3,4,5,6],time:'09:00',variant:'any',icon:'backpack'},
    {id:'b',name:'Outing',group:'Activities',enabled:true,days:[0,1,2,3,4,5,6],time:'10:00',variant:'lunch-out',icon:'utensils'},
    {id:'c',name:'Home option',group:'Activities',enabled:true,days:[0,1,2,3,4,5,6],time:'10:30',variant:'lunch-in',icon:'car'}],calendars:[],cameras:[]};
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
  try{
    await browser.route('**/api/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/settings'){if(route.request().method()==='POST')Object.assign(config,route.request().postDataJSON());return route.fulfill({json:config});}
      if(url.pathname==='/api/events')return route.fulfill({json:{events:[],sources:[],updated:null}});
      if(url.pathname==='/api/cameras')return route.fulfill({json:{revision:'fixture',cameras:[]}});
      if(url.pathname==='/api/accounts')return route.fulfill({json:[]});
      if(url.pathname==='/api/oauth/config')return route.fulfill({json:{google:{configured:false},microsoft:{configured:false}}});
      return route.fulfill({json:{ok:true}});
    });
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/');await until(page,()=>document.getElementById('clock').textContent.length>0);
    await page.evaluate(()=>{for(const key of ['kitchen-theme','kitchen-night-mode','kitchen-time-tools'])localStorage.removeItem(key);});
    await page.reload();await until(page,()=>document.body.dataset.night==='true');
    await page.locator('#night-toggle').click();assert.equal(await page.locator('body').getAttribute('data-night'),'false','Scheduled dim toggles bright');
    const override=await page.evaluate(()=>JSON.parse(localStorage.getItem('kitchen-night-mode')));assert(Number.isFinite(override.expiresAt));
    await page.evaluate(()=>{nightOverride.expiresAt=Date.now()-1;updateNightMode();});
    assert.equal(await page.locator('body').getAttribute('data-night-mode'),'auto');assert.equal(await page.locator('body').getAttribute('data-night'),'true','Next boundary resumes schedule');
    await page.locator('#night-toggle').click();
    await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('kitchen-night-mode'));saved.expiresAt=Date.now()-1;localStorage.setItem('kitchen-night-mode',JSON.stringify(saved));});
    await page.reload();await until(page,()=>document.body.dataset.nightMode==='auto');assert.equal(await page.locator('body').getAttribute('data-night'),'true','Expired override also resets after reload');
    config.nightEnabled=false;await page.evaluate(()=>update());
    await page.locator('#night-toggle').click();assert.equal(await page.locator('body').getAttribute('data-night'),'true','Scheduled bright toggles dim');
    await page.locator('#night-auto').click();
    await page.locator('#theme-toggle').click();assert.equal(await page.locator('body').getAttribute('data-theme'),'light');
    const settings=await browser.newPage();settings.on('pageerror',error=>errors.push(error.message));
    await settings.goto(base+'/settings');await until(settings,()=>document.getElementById('theme').value==='light');
    assert.equal(await settings.locator('body').getAttribute('data-theme'),'light','Settings follows shortcut');
    await settings.locator('#theme').selectOption('dark');await until(page,()=>document.body.dataset.theme==='dark');
    await settings.locator('#theme').selectOption('light');await until(page,()=>document.body.dataset.theme==='light');
    await page.locator('#open-school').click();assert(await page.locator('#time-tools').isVisible());
    assert.equal(await page.locator('.activity-timer').count(),2);
    assert.match(await page.locator('#activity-timers').textContent(),/Home option/);
    await page.locator('[data-lunch=lunch-out]').click();assert.match(await page.locator('#activity-timers').textContent(),/Outing/);assert.doesNotMatch(await page.locator('#activity-timers').textContent(),/Home option/);
    await page.locator('[data-lunch=lunch-in]').click();
    const closeStyles=await page.evaluate(()=>['close-cameras','close-time-tools'].map(id=>{const button=document.getElementById(id),s=getComputedStyle(button),icon=getComputedStyle(button.querySelector('svg'));return [s.width,s.height,s.border,s.borderRadius,s.backgroundColor,s.color,icon.width,icon.height];}));
    assert.deepEqual(closeStyles[0],closeStyles[1],'Camera and timer close controls have identical visual styling');
    await page.locator('.activity-expand').first().click();
    assert(await page.locator('#activity-focus').isVisible());assert(await page.locator('#activity-timers').isHidden());
    assert.equal(await page.locator('#activity-focus-title').textContent(),'First activity');
    await page.evaluate(()=>{window.activityOriginalNow=Date.now;window.focusedTestAt=Number(document.querySelector('.activity-timer').dataset.at);Date.now=()=>window.focusedTestAt-1800000;});
    await until(page,()=>document.getElementById('activity-dial').dataset.fraction==='0.5');
    assert.equal(await page.locator('#activity-focus-remaining').textContent(),'30:00');
    assert.equal(await page.locator('#activity-focus-state').count(),0,'No status label shifts the centred clock');
    assert.equal(await page.locator('#activity-minute-ring').getAttribute('aria-valuenow'),'60.0');
    assert.equal(await page.locator('#activity-pie').getAttribute('aria-valuenow'),'30.0');
    assert.equal(await page.locator('#activity-dial').evaluate(el=>el.style.getPropertyValue('--pie-angle')),'180.000deg');
    await page.evaluate(()=>Date.now=()=>window.focusedTestAt-1830000);
    await until(page,()=>document.getElementById('activity-dial').dataset.minuteFraction==='0.5');
    assert.equal(await page.locator('#activity-focus-remaining').textContent(),'30:30');
    assert.equal(await page.locator('#activity-minute-ring').getAttribute('aria-valuenow'),'30.0');
    assert.equal(await page.locator('#activity-dial').evaluate(el=>el.style.getPropertyValue('--minute-angle')),'180.000deg');
    for(const [width,height,name] of [[1080,1920,'activity-focus-portrait'],[1440,900,'activity-focus-desktop'],[390,844,'activity-focus-mobile'],[320,720,'activity-focus-small'],[900,540,'activity-focus-landscape']]){
      await page.setViewportSize({width,height});await page.waitForTimeout(150);
      const fit=await page.evaluate(()=>{const options=document.querySelector('.activity-options').getBoundingClientRect(),focus=document.getElementById('activity-focus').getBoundingClientRect(),dial=document.getElementById('activity-dial').getBoundingClientRect(),clock=document.getElementById('activity-focus-remaining').getBoundingClientRect();return {below:focus.y>=options.bottom,bottom:Math.abs(focus.bottom-(innerHeight-(innerWidth<=700?18:28)))<2,circle:Math.abs(dial.width-dial.height)<1,size:dial.width,clock:clock.x>=dial.x&&clock.right<=dial.right&&clock.y>=dial.y&&clock.bottom<=dial.bottom,centred:Math.abs(clock.x+clock.width/2-dial.x-dial.width/2)<1&&Math.abs(clock.y+clock.height/2-dial.y-dial.height/2)<1,overflow:document.getElementById('time-tools').scrollHeight>document.getElementById('time-tools').clientHeight+1};});
      assert(fit.below&&fit.bottom&&fit.circle&&fit.size>100&&fit.clock&&fit.centred&&!fit.overflow,name+' fits: '+JSON.stringify(fit));
      await page.screenshot({path:path.join(__dirname,'../test-results/'+name+'.png')});
    }
    await settings.locator('#theme').selectOption('dark');await until(page,()=>document.body.dataset.theme==='dark');await page.setViewportSize({width:1080,height:1920});await page.waitForTimeout(800);
    await page.screenshot({path:path.join(__dirname,'../test-results/activity-focus-dark.png')});
    await page.evaluate(()=>Date.now=()=>window.focusedTestAt-7200000);await until(page,()=>document.getElementById('activity-dial').dataset.fraction==='1');
    assert.equal(await page.locator('#activity-focus-remaining').textContent(),'120:00','Hours become total minutes, not discarded time');
    await page.evaluate(()=>Date.now=()=>window.focusedTestAt-1800001);
    await until(page,()=>Number(document.getElementById('activity-dial').dataset.minuteFraction)<.001);
    await page.evaluate(()=>Date.now=()=>window.focusedTestAt-1800000);
    await until(page,()=>document.getElementById('activity-dial').dataset.minuteFraction==='1');
    await page.evaluate(()=>Date.now=()=>window.focusedTestAt+1);await until(page,()=>document.getElementById('activity-dial').dataset.fraction==='0');
    assert.equal(await page.locator('#activity-focus-remaining').textContent(),'00:00');assert.equal(await page.locator('#activity-dial').getAttribute('data-minute-fraction'),'0');
    await page.evaluate(()=>Date.now=window.activityOriginalNow);
    await page.locator('#activity-unfocus').click();assert(await page.locator('#activity-timers').isVisible());
    assert.equal(await page.locator('.activity-expand').first().evaluate(el=>el===document.activeElement),true,'Return restores keyboard focus');
    await page.locator('.activity-expand').first().focus();await page.keyboard.press('Enter');assert(await page.locator('#activity-focus').isVisible());
    await page.keyboard.press('Escape');assert(await page.locator('#activity-timers').isVisible());assert(await page.locator('#time-tools').isVisible(),'Escape first returns to all activity timers');
    await page.locator('.activity-expand').last().click();await page.locator('[data-lunch=lunch-out]').click();assert(await page.locator('#activity-focus').isHidden(),'Changing lunch choice exits a timer no longer included');
    await page.locator('[data-lunch=lunch-in]').click();await settings.locator('#theme').selectOption('light');
    for(const [width,height,name] of [[1080,1920,'activities-portrait'],[390,844,'activities-mobile'],[320,720,'activities-small']]){
      await page.setViewportSize({width,height});await page.waitForTimeout(800);
      assert.equal(await page.locator('#time-tools').evaluate(el=>el.scrollWidth>el.clientWidth),false,name+' overflow');
      await page.screenshot({path:path.join(__dirname,'../test-results/'+name+'.png')});
    }
    await page.locator('#close-time-tools').click();await page.setViewportSize({width:1080,height:1920});
    await page.locator('#open-time-tools').click();assert.equal(await page.locator('.timer-row').count(),1);
    await page.locator('#timer-sound').click();
    const first=page.locator('.timer-row').first();await first.locator('.timer-minutes').fill('0');await first.locator('.timer-minutes').dispatchEvent('change');await first.locator('.timer-seconds').fill('2');await first.locator('.timer-seconds').dispatchEvent('change');
    await first.locator('.timer-toggle').click();await page.locator('#add-timer').click();
    const second=page.locator('.timer-row').nth(1);await second.locator('.timer-minutes').fill('0');await second.locator('.timer-minutes').dispatchEvent('change');await second.locator('.timer-seconds').fill('5');await second.locator('.timer-seconds').dispatchEvent('change');await second.locator('.timer-toggle').click();
    await until(page,()=>document.querySelector('.timer-row').dataset.status==='finished');
    assert.equal(await second.getAttribute('data-status'),'running','Timers run independently');
    await second.locator('.timer-toggle').click();assert.equal(await second.getAttribute('data-status'),'paused');
    await first.locator('.timer-ack').click();await until(page,()=>document.getElementById('timer-badge').hidden);
    await page.reload();await until(page,()=>document.getElementById('clock').textContent.length>0);await page.locator('#open-time-tools').click();
    assert.equal(await page.locator('.timer-row').nth(1).getAttribute('data-status'),'paused','Paused timer survives reload');
    await page.locator('.timer-row').nth(1).locator('.timer-extend').click();await page.locator('.timer-row').nth(1).locator('.timer-toggle').click();assert.equal(await page.locator('.timer-row').nth(1).getAttribute('data-status'),'running');
    await page.locator('.timer-row').nth(1).locator('.timer-reset').click();assert.equal(await page.locator('.timer-row').nth(1).getAttribute('data-status'),'idle');
    await page.locator('#tab-stopwatch').click();await page.locator('#stopwatch-toggle').click();await page.waitForTimeout(300);await page.locator('#stopwatch-lap').click();await page.locator('#stopwatch-toggle').click();
    assert.equal(await page.locator('#stopwatch-laps li').count(),1);const elapsed=await page.locator('#stopwatch-time').textContent();assert.notEqual(elapsed,'00:00:00.00');await page.waitForTimeout(200);assert.equal(await page.locator('#stopwatch-time').textContent(),elapsed,'Stopwatch pause is stable');
    await page.locator('#stopwatch-reset').click();assert.equal(await page.locator('#stopwatch-time').textContent(),'00:00:00.00');
    for(const [width,height,name] of [[1080,1920,'stopwatch-portrait'],[320,720,'stopwatch-small']]){await page.setViewportSize({width,height});assert.equal(await page.locator('#time-tools').evaluate(el=>el.scrollWidth>el.clientWidth),false);await page.screenshot({path:path.join(__dirname,'../test-results/'+name+'.png')});}
    await page.keyboard.press('Escape');assert(await page.locator('#time-tools').isHidden());
    await settings.locator('.visual-setting').first().evaluate(el=>el.open=true);await settings.locator('.visual-enabled').first().uncheck();await settings.locator('#add-visual-timer').click();
    assert.equal(await settings.locator('.visual-setting').count(),4);
    await settings.locator('#save').click();await until(settings,()=>document.getElementById('save-status').textContent==='Saved');
    assert.equal(config.visualTimers.length,4);assert.equal(config.visualTimers[0].enabled,false);
    await settings.locator('.visual-setting').last().evaluate(el=>el.open=true);await settings.locator('.visual-remove').last().click();await settings.locator('#save').click();await until(settings,()=>document.getElementById('save-status').textContent==='Saved');assert.equal(config.visualTimers.length,3);
    config.timeToolsEnabled=config.visualTimersEnabled=false;await page.evaluate(()=>update());await until(page,()=>document.getElementById('open-time-tools').disabled&&document.getElementById('open-school').disabled);
    assert.deepEqual(errors,[]);console.log('PASS: scheduled dim/bright overrides and expiry, settings theme sync, multiple timers, alert acknowledgement, reload/pause, stopwatch/laps, visual variants/settings and responsive views');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
