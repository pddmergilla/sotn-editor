(() => {
  "use strict";
  const playURL=new URL("play.html",document.currentScript.src);
  let player=null,pending=false;
  window.SotnPlayLauncher={async launch(build,status){
    if(pending)return;
    if(location.protocol!=="http:"&&location.protocol!=="https:"){
      const message="Test needs the editor opened through its local server. Double-click Start Editor.cmd in the editor folder, then reopen your BIN in the browser that opens. Keep the server window open. Unsaved edits stay in this tab; export them before switching.";
      status(message);window.alert(message);return;
    }
    if(player&&!player.closed){player.focus();status("Close the previous play tab before building another test copy.");return;}
    const token=crypto.randomUUID();
    player=window.open(`${playURL.href}#${token}`,"_blank");
    if(!player){status("Allow pop-ups for this site, then select Test in browser again.");return;}
    const target=player;
    pending=true;
    let timer,listener;
    const ready=new Promise((resolve,reject)=>{
      listener=e=>{
        if(e.origin===location.origin&&e.source===target&&e.data?.type==="sotn-play-ready"&&e.data.token===token)resolve();
      };
      window.addEventListener("message",listener);
      timer=setTimeout(()=>reject(new Error("The play tab did not open; close it and try again.")),20000);
    });
    try{
      const [payload]=await Promise.all([build(),ready]);
      if(target.closed)throw new Error("The play tab was closed.");
      target.postMessage({type:"sotn-play-build",token,...payload},location.origin);
    }catch(error){
      if(!target.closed)target.postMessage({type:"sotn-play-error",token,message:error.message},location.origin);
      status(error.message||String(error));
    }finally{
      clearTimeout(timer);window.removeEventListener("message",listener);pending=false;
    }
  }};
})();
