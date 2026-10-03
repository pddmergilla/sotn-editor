(() => {
  "use strict";
  const C=window.SotnPlayCore,S=window.SotnPlayStore,Card=window.SotnPlayCard,$=id=>document.getElementById(id);
  const token=location.hash.slice(1),origin=location.origin,urls=[];
  let build=null,bios=null,audio=null,running=false,starting=false,releaseLock=null,saveTimer=null,saving=null,identity=null,stateBusy=false,cardBytes=null;
  const status=text=>$("status").textContent=text;
  const objectURL=blob=>{const url=URL.createObjectURL(blob);urls.push(url);return url;};
  let keyboardTouched=false;
  function keyboardPreset(){return C.keyboards[$("keyboardPreset").value]?$("keyboardPreset").value:"classic";}
  function updateKeyboard(){
    $("keyboardHelp").textContent=C.keyboards[keyboardPreset()].help;
    if(running)C.applyKeyboard(window.EJS_emulator,keyboardPreset());
  }
  updateKeyboard();
  $("keyboardPreset").onchange=async()=>{
    keyboardTouched=true;updateKeyboard();
    try{await S.put("keyboardPreset",keyboardPreset());}
    catch(error){$("saveStatus").textContent="Keyboard layout applies now, but could not be remembered: "+error.message;}
  };
  function setFastForward(enabled){
    const emulator=window.EJS_emulator;
    if(!running||!emulator?.gameManager)return;
    if(enabled)emulator.changeSettingOption("ff-ratio","3.0");
    emulator.changeSettingOption("fastForward",enabled?"enabled":"disabled");
    $("fastForward").setAttribute("aria-pressed",String(enabled));
    $("fastForward").textContent="⏩ Fast forward: "+(enabled?"on (3×)":"off");
  }
  $("fastForward").onclick=()=>setFastForward(!window.EJS_emulator?.isFastForward);
  window.addEventListener("keydown",event=>{
    if(!running||event.key!=="`"||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||event.isComposing)return;
    if(event.target?.isContentEditable||event.target?.closest?.("input,textarea,select,[role='textbox']"))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!event.repeat)$("fastForward").onclick();
  },true);
  window.addEventListener("keyup",event=>{
    if(running&&event.key==="`"&&!event.target?.isContentEditable&&!event.target?.closest?.("input,textarea,select,[role='textbox']")){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  window.addEventListener("blur",()=>setFastForward(false));
  function acceptBuild(value){
    if(!(value?.blob instanceof Blob)||!value.blob.size||![2048,2352].includes(value.sectorSize))throw new Error("The test copy is invalid; build it again in the editor.");
    build={blob:value.blob,name:String(value.name||"SOTN.bin"),sectorSize:value.sectorSize,dataOffset:value.dataOffset};
    $("start").disabled=false;$("download").disabled=false;
    status(`${build.name} — patched test copy ready (${Math.round(build.blob.size/1048576)} MB).`);
  }
  window.addEventListener("message",event=>{
    if(event.origin!==origin||event.source!==window.opener||event.data?.token!==token||!token||build||starting)return;
    if(event.data.type==="sotn-play-build"){
      try{acceptBuild(event.data);}catch(error){status(error.message);}
    }else if(event.data.type==="sotn-play-error")status(event.data.message);
  });
  async function acquireLock(){
    if(!navigator.locks)throw new Error("Use desktop Chrome or Edge over HTTPS or localhost for safe browser saves.");
    await new Promise((resolve,reject)=>{
      navigator.locks.request("sotn-editor-memory-card",{ifAvailable:true},lock=>{
        if(!lock){reject(new Error("Another play tab is using the memory card; close it first."));return;}
        return new Promise(release=>{releaseLock=release;resolve();});
      }).catch(reject);
    });
  }
  function flushCard(){
    if(saving)return saving;
    const manager=window.EJS_emulator?.gameManager;
    if(!running||!manager)return Promise.resolve();
    saving=(async()=>{
      await Card.save(manager,S,C);
      $("saveStatus").textContent=`Memory card synced at ${new Date().toLocaleTimeString()}.`;
    })().finally(()=>{saving=null;});
    return saving;
  }
  async function stateAction(action){
    if(!running||stateBusy)return;
    stateBusy=true;
    $("stop").disabled=true;
    const controls=$("stateControls").querySelectorAll("button,input");
    for(const control of controls)control.disabled=true;
    try{await action();}catch(error){$("stateStatus").textContent=error.message||String(error);}
    finally{stateBusy=false;for(const control of controls)control.disabled=false;$("importState").value="";$("stop").disabled=!running;}
  }
  async function savedState(){
    const value=await S.get(`state:${identity}`);
    if(!(value instanceof Blob))throw new Error("No saved state for this build; select Save state first.");
    return value;
  }
  $("saveState").onclick=()=>stateAction(async()=>{
    const bytes=window.EJS_emulator.gameManager.getState();
    if(!bytes?.length)throw new Error("This core could not create a savestate.");
    await S.put(`state:${identity}`,new Blob([bytes]));
    $("stateStatus").textContent="Savestate saved in this browser for this build.";
  });
  $("loadState").onclick=()=>stateAction(async()=>{
    const blob=await savedState();
    window.EJS_emulator.gameManager.loadState(new Uint8Array(await blob.arrayBuffer()));
    $("stateStatus").textContent="Savestate restored for this build.";
  });
  $("exportState").onclick=()=>stateAction(async()=>{
    const blob=await savedState(),hash=await C.fingerprint(blob);
    const header=JSON.stringify({format:"sotn-editor-state",version:1,build:identity,hash})+"\n";
    const url=URL.createObjectURL(new Blob([header,blob])),a=document.createElement("a");
    a.href=url;a.download=`sotn-${identity.slice(0,12)}.sotnstate`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    $("stateStatus").textContent="Savestate backup exported.";
  });
  $("importState").onchange=()=>stateAction(async()=>{
    const file=$("importState").files[0];if(!file)return;
    if(file.size>32*1024*1024)throw new Error("This savestate file is too large.");
    const prefix=new Uint8Array(await file.slice(0,1024).arrayBuffer()),end=prefix.indexOf(10);
    if(end<0)throw new Error("Choose a .sotnstate file exported by this player.");
    let header;
    try{header=JSON.parse(new TextDecoder().decode(prefix.slice(0,end)));}catch{throw new Error("The savestate header is invalid.");}
    if(header.format!=="sotn-editor-state"||header.version!==1)throw new Error("Choose a .sotnstate file exported by this player.");
    if(header.build!==identity)throw new Error("This state belongs to a different build or BIOS; use its matching test copy.");
    const blob=file.slice(end+1);
    if(!blob.size||await C.fingerprint(blob)!==header.hash)throw new Error("The savestate is incomplete or damaged.");
    await S.put(`state:${identity}`,blob);
    window.EJS_emulator.gameManager.loadState(new Uint8Array(await blob.arrayBuffer()));
    $("stateStatus").textContent="Savestate imported and restored for this build.";
  });
  $("bios").onchange=async()=>{
    const file=$("bios").files[0];if(!file)return;
    if(file.size!==524288){status("Choose a 512 KB PS1 BIOS file, such as scph5501.bin.");$("bios").value="";return;}
    bios=file;$("biosName").textContent=file.name;
    try{await S.put("bios",file);}catch(error){status("BIOS works for this session, but could not be remembered: "+error.message);}
  };
  $("forgetBios").onclick=async()=>{
    try{await S.delete("bios");bios=null;$("bios").value="";$("biosName").textContent="No BIOS selected; compatibility without one is not guaranteed.";}
    catch(error){status("Could not forget BIOS: "+error.message);}
  };
  $("audio").onchange=()=>{
    const file=$("audio").files[0];
    if(file&&(file.size<=150*2352||file.size%2352)){audio=null;$("audio").value="";status("Choose the original raw US Track 2 BIN, including its audio pregap.");return;}
    audio=file||null;
  };
  $("download").onclick=()=>{
    if(!build)return;
    const a=document.createElement("a"),url=URL.createObjectURL(build.blob);
    a.href=url;a.download=build.name.replace(/\.[^.]+$/,"")+"-test.bin";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  };
  $("resume").onclick=async()=>{
    try{
      const stored=await S.get("lastBuild");acceptBuild(stored);audio=stored.audio||null;
      status("Stored test copy loaded"+(audio?" with Track 2":"")+"; select Start game.");
    }catch(error){status(error.message);}
  };
  $("forgetBuild").onclick=async()=>{
    try{await S.delete("lastBuild");$("resume").hidden=true;status("Stored test copy removed; saves and BIOS are kept.");}
    catch(error){status("Could not remove stored copy: "+error.message);}
  };
  $("start").onclick=async()=>{
    if(!build||starting||running)return;
    starting=true;$("start").disabled=true;
    let loaderAdded=false;
    try{
      await acquireLock();
      cardBytes=await Card.read(S,C);
      for(const el of $("setup").querySelectorAll("input,button"))el.disabled=true;
      status("Identifying this build so its savestates stay separate…");
      const parts=[C.VERSION,await C.fingerprint(build.blob),build.sectorSize,build.dataOffset];
      parts.push(bios?await C.fingerprint(bios):"hle",audio?await C.fingerprint(audio):"no-audio");
      identity=await C.fingerprint(new Blob([JSON.stringify(parts)]));
      if($("keepBuild").checked){
        try{await S.put("lastBuild",{...build,audio});}
        catch(error){$("saveStatus").textContent="Test copy could not be stored; keep this tab open or rebuild after reload: "+error.message;}
      }
      if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
      window.EJS_player="#game";
      window.EJS_core="pcsx_rearmed";
      window.EJS_pathtodata=`https://cdn.emulatorjs.org/${C.VERSION}/data/`;
      window.EJS_gameName=`sotn-${identity}`;
      window.EJS_gameUrl=objectURL(C.cueArchive(C.cue(build.sectorSize,build.dataOffset,!!audio)));
      window.EJS_externalFiles={"/track1.bin":build.blob};
      if(audio)window.EJS_externalFiles["/track2.bin"]=audio;
      if(bios)window.EJS_biosUrl=objectURL(C.archive("scph5501.bin",new Uint8Array(await bios.arrayBuffer())));
      window.EJS_disableCue=true;
      window.EJS_CacheLimit=0;
      window.EJS_threads=false;
      window.EJS_startOnLoaded=true;
      window.EJS_disableAutoLang=true;
      window.EJS_defaultControls=C.controls(keyboardPreset());
      window.EJS_defaultOptions={"save-state-location":"browser","save-save-interval":"30"};
      window.EJS_Buttons={exitEmulation:false,saveState:false,loadState:false};
      window.EJS_onGameStart=()=>{
        try{Card.restore(window.EJS_emulator.gameManager,cardBytes);}
        catch(error){starting=false;status("Could not restore the memory card; close this tab and try again: "+error.message);return;}
        $("saveStatus").textContent=cardBytes?"Saved memory card loaded; select your save in the game.":"Memory card ready; save in a save room to keep progress.";
        running=true;starting=false;$("stop").hidden=false;$("setup").hidden=true;$("stateControls").hidden=false;
        updateKeyboard();setFastForward(false);$("playControls").hidden=false;
        status("Game running — controller and keyboard ready.");
        saveTimer=setInterval(()=>flushCard().catch(error=>$("saveStatus").textContent="Memory card sync failed; export a backup: "+error.message),5000);
      };
      window.EJS_ready=()=>status("Loading the PlayStation core and your test copy…");
      const script=document.createElement("script");
      script.src=window.EJS_pathtodata+"loader.js";
      script.onerror=()=>{status("Could not load EmulatorJS; check your connection, then close this tab and test again.");};
      status("Loading EmulatorJS; large disc images can take a while…");
      document.head.appendChild(script);loaderAdded=true;
      setTimeout(()=>{if(!running)status("Still loading? Check the emulator message below; if it failed, close this tab and test again with a PS1 BIOS.");},90000);
    }catch(error){
      status(error.message);
      if(!loaderAdded){releaseLock?.();releaseLock=null;starting=false;for(const el of $("setup").querySelectorAll("input,button"))el.disabled=false;}
    }
  };
  $("stop").onclick=async()=>{
    $("stop").disabled=true;
    try{
      setFastForward(false);
      clearInterval(saveTimer);
      window.EJS_emulator.gameManager.toggleMainLoop(0);
      if(saving)await saving;
      await flushCard();running=false;
      $("game").hidden=true;
      $("stateControls").hidden=true;$("playControls").hidden=true;
      status("Memory card saved; close this tab, then return to the editor for your next test.");
    }catch(error){
      window.EJS_emulator.gameManager.toggleMainLoop(1);
      saveTimer=setInterval(()=>flushCard().catch(()=>{}),5000);
      status("Could not sync the memory card; try again or export it from the emulator: "+error.message);$("stop").disabled=false;
    }
  };
  window.addEventListener("beforeunload",event=>{if(running){event.preventDefault();event.returnValue="";}});
  document.addEventListener("visibilitychange",()=>{if(document.hidden){setFastForward(false);flushCard().catch(error=>$("saveStatus").textContent="Memory card sync failed: "+error.message);}});
  window.addEventListener("pagehide",()=>{clearInterval(saveTimer);urls.forEach(url=>URL.revokeObjectURL(url));releaseLock?.();});
  (async()=>{
    try{
      const savedKeyboard=await S.get("keyboardPreset");
      if(!keyboardTouched&&C.keyboards[savedKeyboard]){$("keyboardPreset").value=savedKeyboard;updateKeyboard();}
      bios=await S.get("bios");if(bios)$("biosName").textContent=bios.name||"Saved PS1 BIOS";
      $("resume").hidden=!(await S.get("lastBuild"));
    }catch(error){$("saveStatus").textContent="Browser storage is unavailable; saves may not persist: "+error.message;}
    if(window.opener&&token)window.opener.postMessage({type:"sotn-play-ready",token},origin);
    else status("Open a BIN in the editor and select Test in browser, or load a stored test copy.");
  })();
})();
