const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const C=require("../play-core.js");
function page({locked=false,storageFails=false,preset=null}={}){
  const elements=new Map(),handlers={},records=new Map(),scripts=[],timers=[];
  if(preset)records.set("keyboardPreset",preset);
  const get=id=>{
    if(!elements.has(id))elements.set(id,{textContent:"",hidden:false,disabled:false,checked:false,files:[],querySelectorAll:()=>[]});
    return elements.get(id);
  };
  const opener={postMessage(){}},window={opener,addEventListener:(name,fn)=>handlers[name]=fn};
  const document={getElementById:get,createElement:()=>({}),head:{appendChild:script=>scripts.push(script)},addEventListener(){}};
  let released=false,syncFailure=false,flushes=0;
  window.SotnPlayCore=C;
  window.SotnPlayStore={get:async key=>records.get(key),put:async(key,value)=>{if(storageFails)throw Error("Quota exceeded");records.set(key,value);},delete:async key=>records.delete(key)};
  let loadedState;
  const manager={getState:()=>new Uint8Array([1,2,3]),loadState:bytes=>loadedState=bytes,
    saveSaveFiles:()=>flushes++,toggleMainLoop(){},FS:{syncfs:(_,cb)=>cb(syncFailure?Error("Disk full"):null)}};
  vm.runInNewContext(fs.readFileSync(require.resolve("../play.js"),"utf8"),{
    window,document,location:{hash:"#test-token",origin:"http://localhost"},Blob,URL,Uint8Array,TextDecoder,Date,console,
    navigator:{locks:{request:async(_,options,callback)=>{await callback(locked?null:{});released=true;}},storage:{persist:async()=>true}},
    setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout(){}
  });
  const deliver=(overrides={})=>handlers.message({origin:"http://localhost",source:opener,data:{type:"sotn-play-build",token:"test-token",blob:new Blob([new Uint8Array(2352)]),sectorSize:2352,dataOffset:24,name:"sample.bin"},...overrides});
  return {get,window,deliver,scripts,records,handlers,manager,timers,setSyncFailure:value=>syncFailure=value,flushes:()=>flushes,released:()=>released,loadedState:()=>loadedState};
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
  p.window.EJS_emulator={gameManager:p.manager};p.window.EJS_onGameStart();
  assert.equal(p.get("stop").hidden,false);
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
  p.setSyncFailure(true);await p.get("stop").onclick();
  assert.match(p.get("status").textContent,/Could not sync/);assert.equal(p.get("stop").disabled,false);
  p.setSyncFailure(false);await p.get("stop").onclick();
  assert.match(p.get("status").textContent,/Memory card saved/);assert.equal(p.get("game").hidden,true);assert(p.flushes()>=2);
  p.handlers.pagehide();await new Promise(resolve=>setImmediate(resolve));assert(p.released());

  const blocked=page({locked:true});blocked.deliver();await blocked.get("start").onclick();
  assert.match(blocked.get("status").textContent,/Another play tab/);assert.equal(blocked.scripts.length,0);
  const full=page({storageFails:true});full.deliver();full.get("keepBuild").checked=true;await full.get("start").onclick();
  assert.equal(full.scripts.length,1);assert.match(full.get("saveStatus").textContent,/could not be stored/);
  full.handlers.pagehide();
  const keyboard=page({preset:"wasd"});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(keyboard.get("keyboardPreset").value,"wasd");assert.match(keyboard.get("keyboardHelp").textContent,/Space Select/);
  keyboard.deliver();await keyboard.get("start").onclick();
  assert.equal(keyboard.window.EJS_defaultControls[0][4].value,"w");
  assert.equal(keyboard.window.EJS_gameName,p.window.EJS_gameName);
  keyboard.window.EJS_emulator={gameManager:{...keyboard.manager,simulateInput(){}},controls:C.controls("wasd"),setupKeys(){}};
  keyboard.window.EJS_onGameStart();
  keyboard.get("keyboardPreset").value="classic";await keyboard.get("keyboardPreset").onchange();
  assert.equal(keyboard.records.get("keyboardPreset"),"classic");assert.equal(keyboard.window.EJS_emulator.controls[0][4].value,"up arrow");
  keyboard.handlers.pagehide();
  console.log("Play page checks passed: configuration, persistent states, checked imports, storage failures, locks and flush retry/stop.");
})().catch(error=>{console.error(error);process.exitCode=1;});
