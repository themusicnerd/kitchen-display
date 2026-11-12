const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

(async()=>{
  const options={headless:true,viewport:{width:1080,height:1920}};
  if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
  const browser=await chromium.launchPersistentContext(process.env.CHROMIUM_PROFILE||fs.mkdtempSync(path.join(os.tmpdir(),'camera-hold-')),options);
  let blocked=null;
  try{
    await browser.route('**/api/stream*',route=>new URL(route.request().url()).searchParams.get('src')===blocked?route.abort():route.continue());
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.TEST_URL||'http://127.0.0.1:8090/');
    await page.waitForFunction(()=>typeof players!=='undefined'&&players.size>=2);
    const ids=await page.evaluate(()=>[...players.keys()]);
    for(const id of ids.slice(0,2))await page.locator(`[data-camera="${id}"]:not(.offline)`).waitFor({timeout:60000});
    for(const [index,expanded] of [[0,false],[1,true]]){
      const id=ids[index],panel=page.locator(`[data-camera="${id}"]`);
      if(expanded)await page.locator('.camera-expand').first().click();
      blocked=id;await panel.locator('.camera-refresh').click();
      await panel.locator('.camera-held-frame').waitFor({state:'visible'});
      assert(await panel.evaluate(el=>el.classList.contains('offline')));
      assert.match(await panel.locator('.camera-error').textContent(),/last image/);
      const pixels=await panel.locator('canvas').evaluate(canvas=>{
        const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let light=0;for(let i=0;i<data.length;i+=400)light+=data[i]+data[i+1]+data[i+2];
        return {width:canvas.width,height:canvas.height,light,url:canvas.toDataURL()};
      });
      assert(pixels.width>100&&pixels.height>100&&pixels.light>0,'Held frame contains decoded camera pixels');
      await page.waitForTimeout(1600);
      assert(await panel.locator('canvas').evaluate(canvas=>canvas.toDataURL())===pixels.url,'Last frame remains intact while the stream is unavailable');
      const geometry=await panel.evaluate(el=>{
        const a=el.getBoundingClientRect(),b=el.querySelector('canvas').getBoundingClientRect();
        return Math.abs(a.width-b.width)<2&&Math.abs(a.height-b.height)<2;
      });assert(geometry,'Held image fills the same surface in normal and expanded views');
      blocked=null;await panel.locator('.camera-refresh').click();
      await page.locator(`[data-camera="${id}"]:not(.offline)`).waitFor({timeout:60000});
      assert(await panel.locator('canvas').isHidden(),'New live frames replace the held frame');
      if(expanded)await page.locator('#close-cameras').click();
    }
    // Exercise the fatal-error teardown before the five-second retry begins.
    await page.evaluate(id=>players.get(id).hls.trigger(Hls.Events.ERROR,{fatal:true,type:Hls.ErrorTypes.NETWORK_ERROR,details:Hls.ErrorDetails.MANIFEST_LOAD_ERROR}),ids[0]);
    const first=page.locator(`[data-camera="${ids[0]}"]`);
    assert(await first.locator('canvas').isVisible());
    assert.match(await first.locator('.camera-error').textContent(),/last image/);
    await page.locator(`[data-camera="${ids[0]}"]:not(.offline)`).waitFor({timeout:60000});
    assert(await first.locator('canvas').isHidden());
    assert.deepEqual(errors,[]);
    console.log('PASS: real decoded frames survive reconnects and fatal teardown, both camera views recover independently.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
