const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
async function waitUntil(page,predicate){
  for(let attempt=0;attempt<100;attempt++){if(await page.evaluate(predicate))return;await page.waitForTimeout(100);}
  throw Error('Timed out waiting for UI');
}

(async()=>{
  const options={headless:true,viewport:{width:1080,height:1920}};
  if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
  const profile=process.env.CHROMIUM_PROFILE||fs.mkdtempSync(path.join(os.tmpdir(),'kitchen-ui-'));
  const browser=await chromium.launchPersistentContext(profile,options);
  const base=process.env.TEST_URL||'http://127.0.0.1:8090';
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
  const config={revision:'fixture',title:'Family calendar',timezone:'Australia/Sydney',upcomingWeeks:3,weekHeight:640,fontWeight:460,cameraHeight:230,theme:'dark',cameraFit:'contain',showCamera:true,hidePrivateEvents:true,nightEnabled:true,nightStart:'22:00',nightEnd:'18:30',nightBrightness:25,calendars:[],cameras:[]};
  let cameraPayload;
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
      if(url.pathname==='/api/events')return route.fulfill({json:{events:[],sources:[],updated:null}});
      if(url.pathname==='/api/accounts')return route.fulfill({json:[]});
      if(url.pathname==='/api/oauth/config')return route.fulfill({json:{google:{clientId:'',configured:false},microsoft:{clientId:'',configured:false}}});
      return route.fulfill({json:{ok:true}});
    });
    await page.goto(base+'/settings');await page.waitForSelector('.camera-source');
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
    await page.goto(base+'/');await waitUntil(page,()=>document.getElementById('clock').textContent.length>0);
    await page.evaluate(()=>{config.nightStart='00:00';config.nightEnd='23:59';config.nightBrightness=25;updateNightMode();});
    await page.waitForTimeout(1400);assert.equal(await page.locator('body').getAttribute('data-night'),'true');
    assert.equal(Number(await page.locator('.night-dimmer').evaluate(el=>getComputedStyle(el).opacity)),.75);
    await page.evaluate(()=>{config.nightEnabled=false;updateNightMode();});await page.waitForTimeout(1400);
    assert.equal(Number(await page.locator('.night-dimmer').evaluate(el=>getComputedStyle(el).opacity)),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: camera editing/add/remove/password retention; night settings/preview/save; portrait/mobile/desktop fit; scheduled overlay and disabled mode');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
