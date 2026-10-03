const assert=require("node:assert/strict"),Card=require("../play-card.js"),C=require("../play-core.js");
function manager(bytes=new Uint8Array([77,67,0])){
  let card=bytes.slice(),file=card.slice(),paused=false;
  const calls=[];
  return {calls,getSaveFilePath:()=>"/data/saves/sotn-editor-test.srm",
    saveSaveFiles(){file=card.slice();calls.push("save");},getSaveFile:()=>file,
    toggleMainLoop(value){paused=!value;calls.push(value?"resume":"pause");},
    writeFile(path,bytes){assert(paused);assert.equal(path,this.getSaveFilePath());file=bytes.slice();calls.push("write");},
    loadSaveFiles(){assert(paused);card=file.slice();calls.push("load");},
    FS:{syncfs(populate,cb){assert.equal(populate,false);calls.push("sync");cb(null);}},card:()=>card};
}
(async()=>{
  const records=new Map(),store={get:async key=>records.get(key),put:async(key,value)=>records.set(key,value)};
  assert.equal(await Card.read(store,C),null);
  const saved=new Uint8Array([77,67,42,5,9]),first=manager(saved);
  await Card.save(first,store,C);assert.deepEqual(first.calls,["save","sync"]);
  const second=manager();Card.restore(second,await Card.read(store,C));
  assert.deepEqual(second.card(),saved);assert.deepEqual(second.calls,["pause","write","load","resume"]);
  await Card.save(second,store,C);assert.deepEqual(await Card.read(store,C),saved);
  const anotherBuild=manager();Card.restore(anotherBuild,await Card.read(store,C));assert.deepEqual(anotherBuild.card(),saved);
  const legacy=manager(saved);Card.restore(legacy,null);assert.deepEqual(legacy.card(),saved);assert.deepEqual(legacy.calls,[]);
  const intact=records.get("memoryCard");
  records.set("memoryCard",{...intact,hash:"damaged"});await assert.rejects(Card.read(store,C),/damaged/);
  records.set("memoryCard",{...intact,blob:new Blob([])});await assert.rejects(Card.read(store,C),/damaged/);
  records.set("memoryCard",intact);
  await assert.rejects(Card.save(first,{...store,put:async()=>{throw Error("Quota exceeded");}},C),/Quota/);
  assert.equal(records.get("memoryCard"),intact);
  await assert.rejects(Card.save({...first,getSaveFile:()=>null},store,C),/did not provide/);
  await assert.rejects(Card.save(first,{get:async()=>({...intact,hash:"bad"}),put:async()=>{}},C),/damaged/);
  const broken=manager();broken.loadSaveFiles=()=>{throw Error("Card load failed");};
  assert.throws(()=>Card.restore(broken,saved),/Card load failed/);assert(!broken.calls.includes("resume"));
  console.log("Memory-card checks passed: verified writes, fresh-core reload, shared builds, legacy fallback and failure protection.");
})().catch(error=>{console.error(error);process.exitCode=1;});
