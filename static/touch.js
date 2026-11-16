(function(){
  let installed=false;
  function install(force=false){
    if(installed||(!force&&!/Firefox\//.test(navigator.userAgent)))return;
    installed=true;
    let active=null,pending=null,lastFallback=null,injecting=false;
    const fingers=new Set();
    function control(target){
      if(!(target instanceof Element))return null;
      const item=target.closest('button,a[href],input[type=checkbox],input[type=radio],label');
      const result=item instanceof HTMLLabelElement?item.control:item;
      if(item instanceof HTMLLabelElement&&!result?.matches('input[type=checkbox],input[type=radio]'))return null;
      return result&&!result.matches(':disabled')&&!result.closest('[inert]')&&!(result instanceof HTMLInputElement&&!['checkbox','radio'].includes(result.type))?result:null;
    }
    function cancel(){active=null;if(pending)clearTimeout(pending.timer);pending=null;}
    document.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='touch')return;
      fingers.add(event.pointerId);cancel();
      const target=control(event.target);
      if(fingers.size===1&&event.isPrimary&&target)active={id:event.pointerId,target,x:event.clientX,y:event.clientY,at:performance.now()};
    },{capture:true,passive:true});
    document.addEventListener('pointermove',event=>{
      if(active&&event.pointerId===active.id&&Math.hypot(event.clientX-active.x,event.clientY-active.y)>12)cancel();
    },{capture:true,passive:true});
    document.addEventListener('pointercancel',event=>{fingers.delete(event.pointerId);cancel();},{capture:true,passive:true});
    document.addEventListener('scroll',cancel,{capture:true,passive:true});
    document.addEventListener('pointerup',event=>{
      if(event.pointerType!=='touch')return;
      fingers.delete(event.pointerId);
      const tap=active;active=null;
      if(!tap||tap.id!==event.pointerId||fingers.size||performance.now()-tap.at>700||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>12)return;
      if(control(document.elementFromPoint(event.clientX,event.clientY))!==tap.target)return;
      pending={target:tap.target};
      pending.timer=setTimeout(()=>{
        const target=pending?.target;pending=null;
        if(!target?.isConnected||target.matches(':disabled'))return;
        lastFallback={target,at:performance.now()};injecting=true;
        try{target.click();}finally{injecting=false;}
      },80);
    },{capture:true,passive:true});
    document.addEventListener('click',event=>{
      if(injecting)return;
      const target=control(event.target);
      if(pending?.target===target){clearTimeout(pending.timer);pending=null;}
      // Older Firefox clicks expose a touch input source instead of pointerType.
      const fromTouch=event.pointerType==='touch'||event.mozInputSource===5||event.sourceCapabilities?.firesTouchEvents;
      if(fromTouch&&lastFallback?.target===target&&performance.now()-lastFallback.at<700){event.preventDefault();event.stopImmediatePropagation();lastFallback=null;}
    },true);
  }
  window.KitchenTouch={install};install();
})();
