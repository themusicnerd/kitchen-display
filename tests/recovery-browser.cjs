const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const options={headless:true,hasTouch:true,viewport:{width:1080,height:1920}};
  if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
  const browser=await chromium.launchPersistentContext(process.env.CHROMIUM_PROFILE||fs.mkdtempSync(path.join(os.tmpdir(),'kitchen-recovery-')),options);
  const base=process.env.TEST_URL||'http://127.0.0.1:8090';
  const config={revision:'fixture',title:'Calendar',timezone:'Australia/Sydney',upcomingWeeks:3,weekHeight:640,fontWeight:460,cameraHeight:230,theme:'dark',paperTexture:false,cameraFit:'contain',showCamera:false,hidePrivateEvents:true,nightEnabled:false,nightStart:'22:00',nightEnd:'06:30',nightBrightness:25,timeToolsEnabled:true,visualTimersEnabled:true,castEnabled:true,castBaseUrl:'',castKnownHosts:[],visualTimers:[],calendars:[],cameras:[]};
  let requests=0,fail=true,generation='old',settingsLoads=0;
  const errors=[];
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
  try{
    await browser.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.pathname==='/api/settings'){settingsLoads++;return route.fulfill({json:config});}
      if(url.pathname==='/api/events')return route.fulfill({json:{events:[],sources:[],updated:null}});
      if(url.pathname==='/api/cameras')return route.fulfill({json:{revision:'fixture',cameras:[]}});
      if(url.pathname==='/api/accounts')return route.fulfill({json:[]});
      if(url.pathname==='/api/cast/state')return route.fulfill({json:{sessions:[]}});
      if(url.pathname==='/api/cast/devices')return route.fulfill({json:{devices:[]}});
      if(url.pathname==='/api/oauth/config')return route.fulfill({json:{google:{configured:false},microsoft:{configured:false}}});
      if(url.pathname==='/api/recovery'){
        if(req.method()==='GET')return route.fulfill({json:{generation}});
        requests++;assert.deepEqual(req.postDataJSON(),{confirm:true});assert.equal(req.headers()['x-kitchen-request'],'1');
        if(fail)return route.fulfill({status:503,json:{error:'Test service manager unavailable'}});
        setTimeout(()=>generation='new',1000);return route.fulfill({status:202,json:{ok:true,generation:'old'}});
      }
      return route.fulfill({json:{ok:true}});
    });
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/settings');await page.locator('#restart-display').waitFor();
    for(const size of [{width:1080,height:1920},{width:390,height:844},{width:320,height:720}]){
      await page.setViewportSize(size);
      const geometry=await page.locator('.settings-heading').evaluate(el=>[...el.children].every(child=>{const r=child.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.height>0;}));assert(geometry,'Header controls stay on screen');
      assert((await page.locator('#restart-display').boundingBox()).height>=52);
      await page.locator('#restart-display').tap();assert(await page.locator('#restart-dialog').isVisible());
      await page.screenshot({path:path.join(__dirname,`../test-results/settings-recovery-${size.width}.png`)});
      await page.locator('#cancel-restart').tap();
    }
    assert.equal(requests,0,'Opening/cancelling must not restart anything');
    await page.locator('#restart-display').tap();await page.locator('#confirm-restart').tap();
    for(let i=0;i<60&&!await page.locator('#restart-status').textContent().then(text=>text.includes('unavailable'));i++)await page.waitForTimeout(100);
    assert.match(await page.locator('#restart-status').textContent(),/unavailable/);
    assert(await page.locator('#confirm-restart').isEnabled());await page.locator('#cancel-restart').tap();
    fail=false;const before=settingsLoads;
    await page.locator('#restart-display').tap();await page.locator('#confirm-restart').tap();
    assert(await page.locator('#confirm-restart').isDisabled());
    for(let i=0;i<100&&settingsLoads===before;i++)await page.waitForTimeout(100);
    assert(settingsLoads>before,'Settings reloads only after a new server generation appears');assert.equal(requests,2);
    await page.goto(base);await page.locator('#open-time-tools').tap();assert(await page.locator('#time-tools').isVisible());
    await page.locator('.timer-row .cast-source').first().tap();assert(await page.locator('#cast-picker').isVisible());await page.locator('#close-cast-picker').tap();
    await page.locator('#close-time-tools').tap();await page.locator('#open-school').tap();assert(await page.locator('#pane-activities').isVisible());await page.locator('#close-time-tools').tap();
    assert.deepEqual(errors,[]);console.log('PASS: touch targets, confirmation/cancel, restart failure/retry, server recovery and dashboard/Cast dialog taps.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
