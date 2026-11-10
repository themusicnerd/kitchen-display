(function(root){
  const key='kitchen-theme';
  let memory=null;
  function theme(config){
    try{memory=JSON.parse(localStorage.getItem(key)||'null');}catch{}
    if(memory&&memory.base===config.theme&&['dark','light'].includes(memory.value))return memory.value;
    if(memory){memory=null;try{localStorage.removeItem(key);}catch{}}
    return config.theme;
  }
  function apply(config){
    const value=theme(config);
    document.body.dataset.theme=value;document.body.dataset.paper=String(config.paperTexture);
    return value;
  }
  function set(config,value){
    memory={value,base:config.theme};
    try{localStorage.setItem(key,JSON.stringify(memory));}catch{}
    // Storage may be disabled; the current view must still respond to the switch.
    document.body.dataset.theme=value;document.body.dataset.paper=String(config.paperTexture);
  }
  root.KitchenAppearance={key,theme,apply,set};
})(globalThis);
