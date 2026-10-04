const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const C=require("../play-core.js");
const Card=require("../play-card.js");
function page({locked=false,storageFails=false,preset=null,records=new Map()}={}){
  const elements=new Map(),handlers={},scripts=[],timers=[],downloads=[],blobs=new Map();
  if(preset)records.set("keyboardPreset",preset);
  const get=id=>{
    if(!elements.has(id))elements.set(id,{textContent:"",hidden:false,disabled:false,checked:false,files:[],click(){downloads.push({name:this.download,blob:blobs.get(this.href)});},querySelectorAll:()=>[],setAttribute(name,value){this[name]=value;}});
    return elements.get(id);
  };
  const opener={postMessage(){}},window={opener,addEventListener:(name,fn)=>handlers[name]=fn};
  const document={getElementById:get,createElement:()=>({click(){downloads.push({name:this.download,blob:blobs.get(this.href)});}}),head:{appendChild:script=>scripts.push(script)},addEventListener:(name,fn)=>handlers[name]=fn};
  let released=false,syncFailure=false,flushes=0;
  window.SotnPlayCore=C;window.SotnPlayCard=Card;
  window.SotnPlayStore={get:async key=>records.get(key),put:async(key,value)=>{if(storageFails)throw Error("Quota exceeded");records.set(key,value);},delete:async key=>records.delete(key)};
  let loadedState,card=new Uint8Array([77,67,1]),cardFile,cardPath="/data/saves/sotn-editor-test.srm";
  const speeds=[];
  const manager={getState:()=>new Uint8Array([1,2,3]),loadState:bytes=>loadedState=bytes,
    getSaveFile:()=>card,saveSaveFiles:()=>flushes++,toggleMainLoop(){},
    getSaveFilePath:()=>cardPath,writeFile(path,bytes){assert.equal(path,cardPath);cardFile=bytes.slice();},loadSaveFiles(){card=cardFile;},
    FS:{syncfs:(_,cb)=>cb(syncFailure?Error("Disk full"):null)}};
  vm.runInNewContext(fs.readFileSync(require.resolve("../play.js"),"utf8"),{
    window,document,location:{hash:"#test-token",origin:"http://localhost"},Blob,URL:{createObjectURL(blob){const url=URL.createObjectURL(blob);blobs.set(url,blob);return url;},revokeObjectURL:URL.revokeObjectURL},Uint8Array,TextDecoder,Date,console,
    navigator:{locks:{request:async(_,options,callback)=>{await callback(locked?null:{});released=true;}},storage:{persist:async()=>true}},
    setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){}
  });
  const deliver=(overrides={})=>handlers.message({origin:"http://localhost",source:opener,data:{type:"sotn-play-build",token:"test-token",blob:new Blob([new Uint8Array(2352)]),sectorSize:2352,dataOffset:24,name:"sample.bin"},...overrides});
  return {get,window,document,deliver,scripts,records,handlers,manager,timers,speeds,downloads,emulator:{gameManager:manager,isFastForward:true,changeSettingOption(name,value){if(name==="fastForward")this.isFastForward=value==="enabled";speeds.push([name,value]);}},setSyncFailure:value=>syncFailure=value,flushes:()=>flushes,released:()=>released,loadedState:()=>loadedState,card:()=>card,setCard:bytes=>card=bytes,setCardPath:path=>cardPath=path};
}
(async()=>{
  const p=page();
  await new Promise(resolve=>setImmediate(resolve));
  p.deliver({origin:"https://wrong.example"});assert.equal(p.get("status").textContent,"");
  p.deliver({source:{}});assert.equal(p.get("status").textContent,"");
  p.deliver();assert.match(p.get("status").textContent,/sample.bin/);
  p.get("keepBuild").checked=true;
  await p.get("start").onclick();
  assert.equal(p.scripts.length,1);assert.match(p.scripts[0].src,/4\.2\.3\/data\/loader.js$/);
  assert.equal(p.window.EJS_core,"pcsx_rearmed");assert.equal(p.window.EJS_threads,false);
  assert(p.window.EJS_externalFiles["/track1.bin"] instanceof Blob);
  assert.equal(p.window.EJS_Buttons.exitEmulation,false);
  assert.equal(p.window.EJS_defaultOptions["save-state-location"],"browser");
  assert(p.records.get("lastBuild").blob instanceof Blob);
  p.window.EJS_emulator=p.emulator;p.window.EJS_onGameStart();
  assert.equal(p.get("stop").hidden,false);
  assert.equal(p.get("playControls").hidden,false);
  assert.equal(p.window.EJS_emulator.isFastForward,false);
  const key=(overrides={})=>({key:"`",preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...overrides});
  const press=key();p.handlers.keydown(press);
  assert(press.prevented&&press.stopped);assert.equal(p.get("fastForward")["aria-pressed"],"true");
  assert.deepEqual(p.speeds.slice(-2),[["ff-ratio","3.0"],["fastForward","enabled"]]);
  p.handlers.keydown(key({repeat:true}));assert.equal(p.window.EJS_emulator.isFastForward,true);
  const release=key();p.handlers.keyup(release);assert(release.stopped);assert.equal(p.window.EJS_emulator.isFastForward,true);
  p.get("fastForward").onclick();assert.equal(p.get("fastForward")["aria-pressed"],"false");
  for(const extra of [{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{isComposing:true},{key:"~"},{target:{isContentEditable:true}},{target:{closest:()=>({})}}]){
    const ignored=key(extra);p.handlers.keydown(ignored);assert.equal(ignored.prevented,undefined);assert.equal(p.window.EJS_emulator.isFastForward,false);
  }
  p.get("fastForward").onclick();p.handlers.blur();assert.equal(p.window.EJS_emulator.isFastForward,false);
  p.get("fastForward").onclick();p.handlers.visibilitychange();assert.equal(p.window.EJS_emulator.isFastForward,true);
  p.document.hidden=true;p.handlers.visibilitychange();assert.equal(p.window.EJS_emulator.isFastForward,false);
  p.document.hidden=false;
  await p.get("loadState").onclick();assert.match(p.get("stateStatus").textContent,/No saved state/);
  await p.get("saveState").onclick();assert.match(p.get("stateStatus").textContent,/saved in this browser/);
  await p.get("loadState").onclick();assert.deepEqual(p.loadedState(),new Uint8Array([1,2,3]));
  const state=new Blob([new Uint8Array([8,9,10])]),identity=p.window.EJS_gameName.slice(5);
  const header={format:"sotn-editor-state",version:1,build:identity,hash:await C.fingerprint(state)};
  p.get("importState").files=[new Blob([JSON.stringify({...header,build:"wrong"})+"\n",state])];
  await p.get("importState").onchange();assert.match(p.get("stateStatus").textContent,/different build/);
  p.get("importState").files=[new Blob([JSON.stringify({...header,hash:"wrong"})+"\n",state])];
  await p.get("importState").onchange();assert.match(p.get("stateStatus").textContent,/damaged/);
  p.get("importState").files=[new Blob([JSON.stringify(header)+"\n",state])];
  await p.get("importState").onchange();assert.deepEqual(p.loadedState(),new Uint8Array([8,9,10]));
  p.get("fastForward").onclick();p.setSyncFailure(true);await p.get("downloadCard").onclick();
  assert.equal(p.window.EJS_emulator.isFastForward,false);
  assert.match(p.get("cardStatus").textContent,/download started.*storage failed.*Disk full/);assert.equal(p.get("stop").disabled,false);
  assert.deepEqual(new Uint8Array(await p.downloads[0].blob.arrayBuffer()),p.card());
  p.setSyncFailure(false);await p.get("stop").onclick();
  assert.match(p.get("status").textContent,/Memory card saved/);assert.equal(p.get("game").hidden,true);assert(p.flushes()>=2);
  assert.equal(p.downloads.length,2);assert.match(p.downloads[1].name,/^sotn-memory-card-.*\.srm$/);
  assert.equal(p.get("playControls").hidden,true);
  p.handlers.keydown(key());assert.equal(p.window.EJS_emulator.isFastForward,false);
  p.handlers.pagehide();await new Promise(resolve=>setImmediate(resolve));assert(p.released());

  const reopened=page({records:p.records});reopened.deliver();await reopened.get("start").onclick();
  reopened.window.EJS_emulator=reopened.emulator;reopened.window.EJS_onGameStart();
  assert.match(reopened.get("saveStatus").textContent,/Saved memory card loaded/);
  assert.deepEqual(reopened.card(),p.card());
  const progress=new Uint8Array([77,67,42,8]);reopened.setCard(progress);
  await reopened.get("stop").onclick();reopened.handlers.pagehide();
  const rebuilt=page({records:p.records});
  rebuilt.deliver({data:{type:"sotn-play-build",token:"test-token",blob:new Blob([new Uint8Array(2352).fill(7)]),sectorSize:2352,dataOffset:24,name:"edited.bin"}});
  await rebuilt.get("start").onclick();assert.notEqual(rebuilt.window.EJS_gameName,p.window.EJS_gameName);
  rebuilt.setCardPath("/data/saves/another-core-path.srm");
  rebuilt.window.EJS_emulator=rebuilt.emulator;rebuilt.window.EJS_onGameStart();assert.deepEqual(rebuilt.card(),progress);
  await rebuilt.get("stop").onclick();rebuilt.handlers.pagehide();
  const damagedRecords=new Map(p.records);damagedRecords.set("memoryCard",{...p.records.get("memoryCard"),hash:"bad"});
  const damaged=page({records:damagedRecords});damaged.deliver();await damaged.get("start").onclick();
  assert.match(damaged.get("status").textContent,/damaged/);assert.equal(damaged.scripts.length,0);
  const restoreFailed=page({records:p.records});restoreFailed.deliver();await restoreFailed.get("start").onclick();
  restoreFailed.window.EJS_emulator=restoreFailed.emulator;restoreFailed.manager.loadSaveFiles=()=>{throw Error("Card read failed");};
  restoreFailed.window.EJS_onGameStart();assert.match(restoreFailed.get("status").textContent,/Could not restore/);
  assert.equal(restoreFailed.timers.length,0);restoreFailed.handlers.pagehide();

  const blocked=page({locked:true});blocked.deliver();await blocked.get("start").onclick();
  assert.match(blocked.get("status").textContent,/Another play tab/);assert.equal(blocked.scripts.length,0);
  const full=page({storageFails:true});full.deliver();full.get("keepBuild").checked=true;await full.get("start").onclick();
  assert.equal(full.scripts.length,1);assert.match(full.get("saveStatus").textContent,/could not be stored/);
  full.window.EJS_emulator=full.emulator;full.window.EJS_onGameStart();await full.get("stop").onclick();
  assert.match(full.get("status").textContent,/download.*Quota exceeded/);assert.equal(full.get("stop").disabled,true);
  assert.equal(full.get("game").hidden,true);assert.equal(full.records.get("memoryCard"),undefined);
  assert.equal(full.downloads.length,1);assert.deepEqual(new Uint8Array(await full.downloads[0].blob.arrayBuffer()),full.card());
  full.handlers.pagehide();
  const portable=new Uint8Array(131072);portable.set([77,67]);portable[8192]=42;
  const exporting=page();exporting.deliver();await exporting.get("start").onclick();
  exporting.window.EJS_emulator=exporting.emulator;exporting.window.EJS_onGameStart();exporting.setCard(portable);
  await exporting.get("downloadCard").onclick();assert.equal(exporting.get("stop").disabled,false);
  assert.equal(exporting.get("cardDownload").hidden,false);
  const importing=page({storageFails:true,records:damagedRecords});importing.deliver();
  importing.get("importCard").files=[exporting.downloads[0].blob];await importing.get("importCard").onchange();
  importing.get("importCard").files=[new Blob(["not a card"])];await importing.get("importCard").onchange();
  assert.match(importing.get("cardStatus").textContent,/raw PS1/);
  await importing.get("start").onclick();assert.equal(importing.scripts.length,1);
  importing.window.EJS_emulator=importing.emulator;importing.window.EJS_onGameStart();assert.deepEqual(importing.card(),portable);
  assert.equal(importing.get("importCard").disabled,true);await importing.get("stop").onclick();
  assert.deepEqual(new Uint8Array(await importing.downloads[0].blob.arrayBuffer()),portable);importing.handlers.pagehide();
  const empty=page();empty.deliver();await empty.get("start").onclick();
  empty.window.EJS_emulator=empty.emulator;empty.window.EJS_onGameStart();empty.setCard(null);
  await empty.get("stop").onclick();assert.equal(empty.downloads.length,0);assert.equal(empty.get("stop").disabled,false);
  assert.match(empty.get("cardStatus").textContent,/Could not download/);assert.notEqual(empty.get("game").hidden,true);empty.handlers.pagehide();
  const keyboard=page({preset:"wasd"});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(keyboard.get("keyboardPreset").value,"wasd");assert.match(keyboard.get("keyboardHelp").textContent,/Space Select/);
  keyboard.deliver();await keyboard.get("start").onclick();
  assert.equal(keyboard.window.EJS_defaultControls[0][4].value,"w");
  assert.equal(keyboard.window.EJS_gameName,p.window.EJS_gameName);
  keyboard.window.EJS_emulator={...keyboard.emulator,gameManager:{...keyboard.manager,simulateInput(){}},controls:C.controls("wasd"),setupKeys(){}};
  keyboard.window.EJS_onGameStart();
  keyboard.handlers.keydown(key());assert.equal(keyboard.window.EJS_emulator.isFastForward,true);
  keyboard.handlers.keydown(key());assert.equal(keyboard.window.EJS_emulator.isFastForward,false);
  keyboard.get("keyboardPreset").value="classic";await keyboard.get("keyboardPreset").onchange();
  assert.equal(keyboard.records.get("keyboardPreset"),"classic");assert.equal(keyboard.window.EJS_emulator.controls[0][4].value,"up arrow");
  keyboard.handlers.keydown(key());assert.equal(keyboard.window.EJS_emulator.isFastForward,true);
  keyboard.handlers.blur();assert.equal(keyboard.window.EJS_emulator.isFastForward,false);
  keyboard.handlers.pagehide();
  console.log("Play page checks passed: card reload/rebuilt copies, card failure protection, fast-forward, keyboard layouts, states, locks and flush retry/stop.");
})().catch(error=>{console.error(error);process.exitCode=1;});
