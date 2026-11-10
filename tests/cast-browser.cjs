const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const options={headless:true,viewport:{width:1080,height:1920}};
  if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
  const browser=await chromium.launchPersistentContext(process.env.CHROMIUM_PROFILE||fs.mkdtempSync(path.join(os.tmpdir(),'kitchen-cast-')),options);
  const base=process.env.TEST_URL||'http://127.0.0.1:8090';
  const config={revision:'fixture',title:'Cast tests',timezone:'Australia/Sydney',upcomingWeeks:3,weekHeight:640,fontWeight:460,cameraHeight:230,theme:'dark',paperTexture:false,cameraFit:'contain',showCamera:false,hidePrivateEvents:true,nightEnabled:false,timeToolsEnabled:true,visualTimersEnabled:true,castEnabled:true,visualTimers:[{id:'a',name:'Get ready',group:'Activities',enabled:true,days:[0,1,2,3,4,5,6],time:'09:00',variant:'any',icon:'backpack'}],calendars:[],cameras:[]};
  const errors=[],calls=[];let sessions=[];
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
  try{
    await browser.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),data=req.method()==='POST'?req.postDataJSON():null;
      if(url.pathname==='/api/settings')return route.fulfill({json:config});
      if(url.pathname==='/api/events')return route.fulfill({json:{events:[],sources:[],updated:null}});
      if(url.pathname==='/api/cameras')return route.fulfill({json:{revision:'fixture',cameras:[]}});
      if(url.pathname==='/api/cast/devices')return route.fulfill({json:{devices:[{id:'screen-one',name:'Test TV',model:'Cast screen'}]}});
      if(url.pathname==='/api/cast/state')return route.fulfill({json:{sessions}});
      if(url.pathname==='/api/cast/start'){
        calls.push({action:'start',data});const job={id:'session-one',deviceName:'Test TV',source:data.source,clientId:data.clientId,lastSeen:Date.now()/1000};sessions=[job];return route.fulfill({json:job});
      }
      if(url.pathname==='/api/cast/update'){calls.push({action:'update',data});return route.fulfill({json:sessions[0]});}
      if(url.pathname==='/api/cast/stop'){calls.push({action:'stop',data});sessions=[];return route.fulfill({json:{ok:true}});}
      return route.fulfill({json:{ok:true}});
    });
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.waitForFunction(()=>typeof config!=='undefined'&&config);
    await page.evaluate(()=>localStorage.removeItem('kitchen-time-tools'));await page.reload();
    await page.locator('#open-time-tools').click();
    await page.locator('.timer-toggle').first().click();
    await page.locator('.timer-row .cast-source').first().click();
    await page.locator('#cast-screen option[value=screen-one]').waitFor({state:'attached'});
    assert.equal(calls.length,0,'Opening the picker must never launch a TV');
    assert(await page.locator('#start-cast').isDisabled());
    await page.locator('#cast-screen').selectOption('screen-one');await page.locator('#start-cast').click();
    await page.waitForFunction(()=>document.querySelector('#cast-sessions').textContent.includes('Connected'));
    assert.equal(calls[0].data.source.kind,'countdown');assert.equal(calls[0].data.timer.status,'running');
    await page.locator('#close-cast-picker').click();await page.locator('.timer-toggle').first().click();
    for(let i=0;i<60&&!calls.some(x=>x.action==='update'&&x.data.timer.status==='paused');i++)await page.waitForTimeout(100);
    assert(calls.some(x=>x.action==='update'&&x.data.timer.status==='paused'),'Pause syncs to TV');
    await page.locator('.timer-row .cast-source').first().click();await page.locator('#cast-sessions button').click();assert.equal(sessions.length,0);
    await page.locator('#close-cast-picker').click();await page.locator('#tab-activities').click();
    const selector=await page.locator('#activity-group').boundingBox();assert(selector.height>=64,'Activity selector is touch-sized');
    await page.locator('.activity-timer>.cast-source').click();assert(await page.locator('#cast-picker').isVisible());
    await page.locator('#close-cast-picker').click();await page.locator('.activity-expand').click();
    await page.locator('#activity-focus .cast-source').click();assert(await page.locator('#cast-picker').isVisible());
    await page.locator('#close-cast-picker').click();
    await page.screenshot({path:path.join(__dirname,'../test-results/cast-touch.png')});
    let timer={name:'Leave for our activity',status:'running',endAt:Date.now()+1830000,remainingMs:1830000,kind:'countdown'},ended=false;
    await browser.route('https://www.gstatic.com/**',route=>route.abort());
    await browser.route('**/cast/state',async route=>{
      assert.equal(route.request().headers().authorization,'Bearer '+'a'.repeat(43));
      return route.fulfill(ended?{status:410,json:{error:'Ended'}}:{json:{timer,theme:'dark',paperTexture:false,timezone:'Australia/Sydney',serverNow:Date.now()}});
    });
    const tv=await browser.newPage();tv.on('pageerror',e=>errors.push(e.message));
    for(const size of [{width:1920,height:1080},{width:1280,height:720},{width:960,height:540}]){
      await tv.setViewportSize(size);await tv.goto(base+'/cast/timer#'+'a'.repeat(43));await tv.locator('#tv-timer').waitFor({state:'visible'});await tv.waitForTimeout(300);
      const g=await tv.evaluate(()=>{
        const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        return {title:box('tv-title'),dial:box('activity-dial'),clock:box('activity-focus-remaining'),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight};
      });
      assert.equal(g.overflow,false);assert(g.dial.width>size.height*.7);assert(Math.abs(g.dial.width-g.dial.height)<2);
      assert(g.title.right<=g.dial.x+1,'Landscape heading and dial do not overlap');assert(g.clock.right<=g.dial.right&&g.clock.x>=g.dial.x);assert(g.dial.bottom<=size.height);
      await tv.screenshot({path:path.join(__dirname,`../test-results/cast-tv-${size.width}.png`)});
    }
    timer={...timer,status:'paused',endAt:null,remainingMs:45000};
    for(let i=0;i<60&&await tv.locator('#tv-state').textContent()!=='Paused';i++)await tv.waitForTimeout(100);
    assert.equal(await tv.locator('#activity-focus-remaining').textContent(),'00:45');
    ended=true;for(let i=0;i<60&&await tv.locator('#tv-message').textContent()!=='Timer sharing ended';i++)await tv.waitForTimeout(100);assert(await tv.locator('#tv-timer').isHidden());
    assert.deepEqual(errors,[]);console.log('Cast picker, touch selector, pause sync, revoke and 16:9 receiver checks passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
