const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const C=require("../play-core.js");
const Disc=require("../sotn-core.js");

async function archiveEntry(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true),0x04034b50);
  const length=view.getUint32(18,true),nameLength=view.getUint16(26,true);
  const start=30+nameLength,central=start+length;
  assert.equal(view.getUint32(central,true),0x02014b50);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
  assert.equal(view.getUint32(bytes.length-6,true),central);
  return {name:new TextDecoder().decode(bytes.slice(30,start)),data:bytes.slice(start,central),crc:view.getUint32(14,true)};
}
function launcher({blocked=false,protocol="http:"}={}){
  const handlers=new Map(),messages=[],statuses=[];
  const target={closed:false,focus(){this.focused=true;},postMessage:(message,origin)=>messages.push({message,origin})};
  const window={open:()=>blocked?null:target,addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
  vm.runInNewContext(fs.readFileSync(require.resolve("../play-launcher.js"),"utf8"),{
    window,document:{currentScript:{src:"http://localhost/subpath/play-launcher.js"}},URL,crypto,
    location:{origin:"http://localhost",protocol},setTimeout,clearTimeout
  });
  return {target,messages,statuses,launch:builder=>window.SotnPlayLauncher.launch(builder,text=>statuses.push(text)),
    ready(overrides={}){handlers.get("message")?.({source:target,origin:"http://localhost",data:{type:"sotn-play-ready",token:this.token},...overrides});},
    window,handlers};
}
(async()=>{
  const text=C.cue(2352,24,true),entry=await archiveEntry(C.cueArchive(text));
  assert.equal(entry.name,"sotn-editor-test.cue");
  assert.equal(new TextDecoder().decode(entry.data),text);
  assert.match(text,/MODE2\/2352/);assert.match(text,/TRACK 02 AUDIO/);assert.match(text,/INDEX 01 00:02:00/);
  assert.doesNotMatch(C.cue(2048,0,false),/TRACK 02/);
  assert.match(C.cue(2048,0,false),/MODE1\/2048/);
  assert.match(C.cue(2352,16,false),/MODE1\/2352/);
  assert.throws(()=>C.cue(123,0,false));
  assert.equal((await archiveEntry(C.archive("test","123456789"))).crc,0xcbf43926);
  const bios=Uint8Array.from([0,255,128,3]);
  assert.deepEqual((await archiveEntry(C.archive("scph5501.bin",bios))).data,bios);

  const source=new Blob([new Uint8Array(4*1024*1024+100)]);
  const modified=Disc.modifiedBlob(source,[{start:source.size-1,modified:new Uint8Array([1])}]);
  assert.equal(new Uint8Array(await source.slice(-1).arrayBuffer())[0],0);
  assert.equal(new Uint8Array(await modified.slice(-1).arrayBuffer())[0],1);
  assert.equal(modified.size,source.size);
  assert.equal(await C.fingerprint(source),await C.fingerprint(Disc.modifiedBlob(source,[])));
  assert.notEqual(await C.fingerprint(source),await C.fingerprint(modified));
  assert.deepEqual(C.controls()[0][0],{value:"z",value2:"BUTTON_1"});
  assert.deepEqual(C.controls()[0][8],{value:"x",value2:"BUTTON_2"});
  for(const player of [1,2,3])assert.deepEqual(C.controls()[player],{});
  const wasd=C.controls("wasd")[0];
  assert.deepEqual(Object.values(wasd).map(control=>control.value),["k","j","space","enter","w","s","a","d","l","i","u","o","7","9"]);
  const released=[];
  const emulator={controls:C.controls(),defaultControllers:C.controls(),gameManager:{simulateInput:(...args)=>released.push(args)},setupKeys(){this.updated=true;}};
  emulator.controls[0][0].value2="custom gamepad button";
  C.applyKeyboard(emulator,"wasd");
  assert.equal(emulator.controls[0][0].value,"k");assert.equal(emulator.controls[0][0].value2,"custom gamepad button");
  assert.equal(emulator.defaultControllers[0][2].value,"space");assert.equal(emulator.updated,true);
  assert.equal(released.length,14);assert(released.every(([player,,value])=>player===0&&value===0));
  C.applyKeyboard(emulator,"classic");assert.equal(emulator.controls[0][0].value,"z");

  const l=launcher();
  l.window.open=url=>{l.token=new URL(url).hash.slice(1);assert.equal(new URL(url).pathname,"/subpath/play.html");return l.target;};
  let built=0;
  const task=l.launch(async()=>{built++;return {blob:modified};});
  l.ready({origin:"https://wrong.example"});
  l.ready({source:{}});
  l.ready({data:{type:"sotn-play-ready",token:"wrong"}});
  await Promise.resolve();assert.equal(l.messages.length,0);
  l.ready();await task;
  assert.equal(l.messages.length,1);assert.equal(l.messages[0].message.blob,modified);
  assert.equal(l.messages[0].origin,"http://localhost");assert.equal(l.handlers.size,0);
  await l.launch(async()=>{built++;});assert.equal(built,1);assert.equal(l.target.focused,true);
  const b=launcher({blocked:true});await b.launch(async()=>{throw Error("should not build");});assert.match(b.statuses[0],/pop-ups/);
  const f=launcher({protocol:"file:"});await f.launch(async()=>{throw Error("should not build");});assert.match(f.statuses[0],/serve/);
  const failure=launcher();await failure.launch(async()=>{throw Error("Invalid edit");});
  assert.match(failure.statuses[0],/Invalid edit/);assert.equal(failure.messages[0].message.type,"sotn-play-error");
  console.log("Browser play checks passed: archives, identities, source preservation, controls, handoff and failure paths.");
})().catch(error=>{console.error(error);process.exitCode=1;});
