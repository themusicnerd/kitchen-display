const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
  const options={headless:true,hasTouch:true,userAgent:'Mozilla/5.0 Firefox/145.0',viewport:{width:800,height:900}};
  if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
  const browser=await chromium.launchPersistentContext(process.env.CHROMIUM_PROFILE||fs.mkdtempSync(path.join(os.tmpdir(),'kitchen-touch-')),options);
  const base=process.env.TEST_URL||'http://127.0.0.1:8090';
  try{
    await browser.route('**/touch-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><script src="/touch.js" defer></script></head><body><button id="target" style="width:200px;height:80px">Button</button><input id="check" type="checkbox"><label for="check">Check</label><button id="disabled" disabled>Disabled</button><input id="text"><div id="scroll" style="height:100px;overflow:auto"><div style="height:500px">Scroll</div></div></body></html>'}));
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/touch-test');
    await page.evaluate(()=>{window.hits=0;document.getElementById('target').onclick=()=>window.hits++;});
    async function emit(type,{id='target',pointerId=42,isPrimary=true,dx=0}={}){
      await page.evaluate(({type,id,pointerId,isPrimary,dx})=>{const el=document.getElementById(id),r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId,isPrimary,clientX:r.x+r.width/2+dx,clientY:r.y+r.height/2}));},{type,id,pointerId,isPrimary,dx});
    }
    const hits=()=>page.evaluate(()=>window.hits);
    await page.locator('#target').tap();await page.waitForTimeout(150);assert.equal(await hits(),1,'Native tap activates once');
    await emit('pointerdown');await emit('pointerup');await page.waitForTimeout(150);assert.equal(await hits(),2,'Missing native click is recovered');
    await emit('click');assert.equal(await hits(),2,'Late native touch click is suppressed');
    await page.locator('#target').click();assert.equal(await hits(),3,'Mouse click is never suppressed');
    await emit('pointerdown');await emit('pointermove',{dx:30});await emit('pointerup');await page.waitForTimeout(150);assert.equal(await hits(),3,'Drag is not a tap');
    await emit('pointerdown');await page.evaluate(()=>document.getElementById('scroll').dispatchEvent(new Event('scroll')));await emit('pointerup');await page.waitForTimeout(150);assert.equal(await hits(),3,'Scroll cancels fallback');
    await emit('pointerdown');await emit('pointercancel');await emit('pointerup');await page.waitForTimeout(150);assert.equal(await hits(),3);
    await emit('pointerdown');await page.waitForTimeout(750);await emit('pointerup');await page.waitForTimeout(150);assert.equal(await hits(),3,'Long press is not a tap');
    await emit('pointerdown');await emit('pointerdown',{pointerId:43,isPrimary:false});await emit('pointerup');await emit('pointerup',{pointerId:43,isPrimary:false});await page.waitForTimeout(150);assert.equal(await hits(),3,'Multitouch is not a tap');
    await page.locator('#check').tap();await page.waitForTimeout(150);assert(await page.locator('#check').isChecked());
    await emit('pointerdown',{id:'check'});await emit('pointerup',{id:'check'});await page.waitForTimeout(150);assert(!await page.locator('#check').isChecked(),'Checkbox fallback toggles once');
    await emit('click',{id:'check'});assert(!await page.locator('#check').isChecked(),'Late checkbox click cannot double-toggle');
    await page.locator('label').tap();await page.waitForTimeout(150);assert(await page.locator('#check').isChecked(),'Native label tap remains normal');
    await emit('pointerdown',{id:'disabled'});await emit('pointerup',{id:'disabled'});await page.waitForTimeout(150);assert.equal(await hits(),3);
    await page.evaluate(()=>{const label=document.createElement('label'),select=document.createElement('select');label.id='native-label';label.htmlFor='native-select';label.textContent='Options';select.id='native-select';select.innerHTML='<option>One</option>';window.selectClicks=0;select.onclick=()=>window.selectClicks++;document.body.append(label,select);});
    await emit('pointerdown',{id:'native-label'});await emit('pointerup',{id:'native-label'});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.selectClicks),0,'Native select labels are not synthesised');
    const other=await browser.newPage();await other.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{get:()=> 'OtherBrowser'}));await other.goto(base+'/touch-test');
    await other.evaluate(()=>{window.hits=0;const el=document.getElementById('target');el.onclick=()=>window.hits++;const r=el.getBoundingClientRect();for(const type of ['pointerdown','pointerup'])el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:1,isPrimary:true,clientX:r.x+20,clientY:r.y+20}));});
    await other.waitForTimeout(150);assert.equal(await other.evaluate(()=>window.hits),0,'Other browsers keep native behaviour');
    assert.deepEqual(errors,[]);console.log('PASS: Firefox missing-click recovery, no duplicate native/mouse clicks, checkbox/label behaviour, drag/scroll/cancel/long-press/multitouch guards.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
