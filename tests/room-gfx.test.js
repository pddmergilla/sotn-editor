const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const S=require("../disc-stage.js");
const C=require("../sotn-core.js");
const T=require("../entity-templates.js");
const EC=require("../entity-catalog.js");

const BASE=0x80180000;

function put16(b,o,v){b[o]=v&255;b[o+1]=v>>>8&255;}
function put32(b,o,v){put16(b,o,v);put16(b,o+2,v>>>16);}
function putEntity(b,o,e){
  put16(b,o,e.x);put16(b,o+2,e.y);b[o+4]=e.id;b[o+5]=e.flags;
  b[o+6]=e.slot;b[o+7]=e.spawnId;put16(b,o+8,e.params);
}
function writeBank(b,o,entries){
  putEntity(b,o,{x:-2,y:-2,id:0,flags:0,slot:0,spawnId:0,params:0});
  entries.forEach((e,i)=>putEntity(b,o+(i+1)*10,e));
  putEntity(b,o+(entries.length+1)*10,{x:-1,y:-1,id:0,flags:0,slot:0,spawnId:0,params:0});
}

function makeFixture(){
  const bytes=new Uint8Array(0x4000);
  put32(bytes,16,BASE+0x3000);put32(bytes,28,BASE+0x500);put32(bytes,32,BASE+0x190);
  bytes.set([1,2,3,4,0,0,0,0],0x3000);
  bytes.set([5,6,7,8,0,0,3,1],0x3008);
  bytes[0x3010]=0x40;
  put32(bytes,0x150,BASE+0x1000);put32(bytes,0x154,BASE+0x300);
  put32(bytes,0x158,0);put16(bytes,0x15c,0);put16(bytes,0x15e,0);
  put32(bytes,0x190,BASE+0x150);put32(bytes,0x194,0);
  put32(bytes,0x300,BASE+0x320);put32(bytes,0x304,BASE+0x340);
  put32(bytes,0x308,BASE+0x360);put32(bytes,0x30c,BASE+0x380);
  const entity={x:20,y:30,id:7,flags:1,slot:2,spawnId:3,params:4};
  writeBank(bytes,0x800,[entity]);writeBank(bytes,0x900,[entity]);
  for(let i=0;i<53;i++){
    put32(bytes,0x500+i*4,BASE+0x800);
    put32(bytes,0x500+53*4+i*4,BASE+0x900);
  }
  return {source:bytes.slice(),stage:S.parseOverlay(bytes)};
}

{
  const {source,stage}=makeFixture();
  const stageSource=stage.bytes.slice();
  assert.equal(stage.rooms[0].roomHeaderOffset,0x3000);
  assert.deepEqual(stage.originalRoomGfxIds,[0,3]);
  assert.equal(Object.isFrozen(stage.originalRoomGfxIds),true);
  assert.equal(S.roomGraphicsDirty(stage),false);

  stage.rooms[0].entityGfxId=3;
  assert.equal(S.roomGraphicsDirty(stage),true);
  const built=S.buildOverlay(stage,false);
  assert.equal(built[0x3006],3);
  for(let i=0;i<source.length;i++){
    if(i!==0x3006)assert.equal(built[i],source[i],`unexpected changed byte at 0x${i.toString(16)}`);
  }
  assert.deepEqual(stage.bytes,stageSource);
  assert.deepEqual(source,stageSource);

  stage.rooms[0].entityGfxId=stage.originalRoomGfxIds[0];
  assert.equal(S.roomGraphicsDirty(stage),false);
  assert.deepEqual(S.buildOverlay(stage,false),source);
}

{
  const {source,stage}=makeFixture();
  const stageSource=stage.bytes.slice();
  stage.rooms[0].entityGfxId=3;
  stage.entityLayouts.entities[0][1].x=88;
  const map=stage.maps.values().next().value;
  map.values[0]=0x1234;map.dirty=true;
  const tiledef=stage.tiledefs.values().next().value;
  tiledef.collisions[1]=0x5A;tiledef.dirty=true;

  const built=S.buildOverlay(stage,true);
  const reparsed=S.parseOverlay(built);
  assert.equal(reparsed.rooms[0].entityGfxId,3);
  const entityIndex=reparsed.entityLayouts.indices[0];
  assert.equal(reparsed.entityLayouts.entities[entityIndex][1].x,88);
  assert.notEqual(reparsed.yPtrs[0],BASE+0x900);
  assert.equal(built[0x1000],0x34);assert.equal(built[0x1001],0x12);
  assert.equal(built[0x381],0x5A);
  assert.deepEqual(stage.bytes,stageSource);
  assert.deepEqual(source,stageSource);
}

for(const value of [-1,256,1.5,NaN,"3"]){
  const {source,stage}=makeFixture();
  stage.rooms[0].entityGfxId=value;
  const stageBytes=stage.bytes.slice();
  assert.throws(()=>S.buildOverlay(stage,false),/graphics ID must be a byte/);
  assert.deepEqual(stage.bytes,stageBytes);
  assert.equal(source[0x3006],0);
}

{
  const {stage}=makeFixture();
  stage.rooms[0].roomHeaderOffset++;
  assert.throws(()=>S.buildOverlay(stage,false),/header offset is invalid/);
}

{
  const {stage}=makeFixture();
  stage.bytes[0x3006]=2;
  const sourceAfterUnexpectedChange=stage.bytes.slice();
  stage.rooms[0].entityGfxId=3;
  assert.throws(()=>S.buildOverlay(stage,false),/original graphics data does not match the source/);
  assert.deepEqual(stage.bytes,sourceAfterUnexpectedChange);
}

{
  const {source}=makeFixture();
  writeBank(source,0xA00,[{x:20,y:30,id:7,flags:1,slot:2,spawnId:3,params:4}]);
  writeBank(source,0xB00,[{x:20,y:30,id:7,flags:1,slot:2,spawnId:3,params:4}]);
  for(let i=1;i<52;i++){
    put32(source,0x500+i*4,BASE+0xA00);
    put32(source,0x500+53*4+i*4,BASE+0xB00);
  }
  put32(source,0x500+52*4,0);
  put32(source,0x500+53*4+52*4,0);
  const stage=S.parseOverlay(source);
  assert.equal(stage.entityLayouts.indices[52],-1);
  stage.entityLayouts.entities[stage.entityLayouts.indices[0]][1].id=8;
  const built=S.buildOverlay(stage,true);
  assert.equal(built[0x800+10+4],8);
  assert.equal(built[0x900+10+4],8);
  assert.equal(new DataView(built.buffer).getUint32(0x500+52*4,true),0);
  assert.deepEqual(stage.bytes,source);

  const second=S.parseOverlay(source);
  const firstBank=second.entityLayouts.entities[second.entityLayouts.indices[0]];
  firstBank.splice(2,0,{...firstBank[1],x:80,y:90,id:9,slot:6,spawnId:0});
  second.banks.get(second.xPtrs[0]).capacity=3;
  second.banks.get(second.yPtrs[0]).capacity=3;
  const expanded=S.parseOverlay(S.buildOverlay(second,true));
  assert.equal(expanded.entityLayouts.indices[52],-1);
  assert.equal(expanded.xPtrs[52],0);
  assert.equal(expanded.yPtrs[52],0);
  const expandedBank=expanded.entityLayouts.entities[expanded.entityLayouts.indices[0]];
  assert(expandedBank.some(entity=>entity.id===9&&entity.x===80&&entity.y===90));
  assert.deepEqual(second.bytes,source);

  const mismatched=source.slice();
  mismatched[0xB00+10+4]=10;
  const third=S.parseOverlay(mismatched);
  const thirdBank=third.entityLayouts.entities[third.entityLayouts.indices[0]];
  thirdBank.splice(2,0,{...thirdBank[1],x:80,y:90,id:9,slot:6,spawnId:0});
  third.banks.get(third.xPtrs[0]).capacity=3;
  third.banks.get(third.yPtrs[0]).capacity=3;
  const rebuilt=S.parseOverlay(S.buildOverlay(third,true));
  assert.equal(rebuilt.banks.get(rebuilt.xPtrs[1]).originalEntries[1].id,7);
  assert.equal(rebuilt.banks.get(rebuilt.yPtrs[1]).originalEntries[1].id,10);
  const unsafe=S.parseOverlay(mismatched);
  unsafe.entityLayouts.entities[unsafe.entityLayouts.indices[1]][1].id=11;
  const repaired=S.parseOverlay(S.buildOverlay(unsafe,true));
  assert.equal(repaired.banks.get(repaired.xPtrs[1]).originalEntries[1].id,11);
  assert.equal(repaired.banks.get(repaired.yPtrs[1]).originalEntries[1].id,11);
  assert.equal(repaired.banks.get(repaired.yPtrs[2]).originalEntries[1].id,10);
  const added=S.parseOverlay(mismatched);
  const addedBank=added.entityLayouts.entities[added.entityLayouts.indices[1]];
  addedBank.splice(2,0,{...addedBank[1],x:70,y:80,id:9,slot:6,spawnId:0});
  const addedResult=S.parseOverlay(S.buildOverlay(added,true));
  assert.equal(addedResult.banks.get(addedResult.xPtrs[1]).originalEntries[2].id,9);
  assert.equal(addedResult.banks.get(addedResult.yPtrs[1]).originalEntries[2].id,9);
  const ambiguous=S.parseOverlay(mismatched);
  ambiguous.banks.get(ambiguous.yPtrs[1]).originalEntries[1].x=200;
  ambiguous.banks.get(ambiguous.yPtrs[1]).originalEntries[1].slot=55;
  ambiguous.entityLayouts.entities[ambiguous.entityLayouts.indices[1]][1].id=11;
  assert.throws(()=>S.buildOverlay(ambiguous,true),/cannot match slot 2/);

  const duplicates=source.slice();
  const secondRow={x:60,y:70,id:12,flags:1,slot:2,spawnId:0,params:5};
  writeBank(duplicates,0xA00,[{x:20,y:30,id:7,flags:1,slot:2,spawnId:3,params:4},secondRow]);
  writeBank(duplicates,0xB00,[{x:20,y:30,id:10,flags:1,slot:2,spawnId:3,params:4},secondRow]);
  const duplicateStage=S.parseOverlay(duplicates);
  duplicateStage.entityLayouts.entities[duplicateStage.entityLayouts.indices[1]][1].id=11;
  const duplicateBuilt=S.parseOverlay(S.buildOverlay(duplicateStage,true));
  assert.equal(duplicateBuilt.banks.get(duplicateBuilt.yPtrs[1]).originalEntries[1].id,11);
  assert.equal(duplicateBuilt.banks.get(duplicateBuilt.yPtrs[1]).originalEntries[2].id,12);
}

async function verifyVanillaCatRoomChange(){
  const defaultPath=path.join(os.homedir(),"Downloads","Castlevania - Symphony of the Night (USA)","Castlevania - Symphony of the Night (USA) (Track 1).bin");
  const binPath=process.env.SOTN_US_BIN||defaultPath;
  if(!fs.existsSync(binPath)){
    console.log("Vanilla US CAT check skipped; set SOTN_US_BIN to run it.");
    return;
  }
  const fileHandle=await fs.promises.open(binPath,"r");
  const stat=await fileHandle.stat();
  const file={
    size:stat.size,
    slice(start,end){
      return {async arrayBuffer(){
        const buffer=Buffer.alloc(end-start);
        const {bytesRead}=await fileHandle.read(buffer,0,buffer.length,start);
        if(bytesRead!==buffer.length)throw new Error("Unexpected end of vanilla BIN.");
        return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
      }};
    }
  };
  try{
    const disc=await C.DiscImage.open(file);
    const record=await disc.findPath(["ST","CAT","CAT.BIN"]);
    const source=await disc.readFile(record);
    const original=source.slice();
    const stage=S.parseOverlay(source);
    assert.ok(stage.rooms.length>18,"CAT overlay has fewer than 19 rooms");
    assert.equal(stage.rooms[14].entityGfxId,0,"CAT room 14 should use graphics bank 0");
    assert.equal(stage.rooms[18].entityGfxId,3,"CAT room 18 should use graphics bank 3");
    stage.rooms[14].entityGfxId=stage.rooms[18].entityGfxId;
    const built=S.buildOverlay(stage,false);
    const target=stage.rooms[14].roomHeaderOffset+6;
    assert.equal(built[target],3);
    for(let i=0;i<original.length;i++){
      if(i!==target)assert.equal(built[i],original[i],`CAT changed byte 0x${i.toString(16)}`);
    }
    assert.deepEqual(source,original);
    assert.deepEqual(stage.bytes,original);
    const choices=T.templates(stage,14,"CAT",EC,18);
    assert(choices.length>0);
    assert(choices.every(choice=>choice.sourceRoomIndex===18));
    const enemy=choices.find(choice=>/Wereskeleton|Bone Ark/.test(choice.type.name));
    assert(enemy,"CAT room 18 should provide an enemy template");
    const bank=stage.entityLayouts.entities[stage.entityLayouts.indices[stage.rooms[14].entityLayoutId]];
    const breakable=bank.find(entity=>EC.typeFor("CAT",entity.id).name==="Breakable");
    assert(breakable,"CAT room 14 should contain a breakable");
    const originalPosition={x:breakable.x,y:breakable.y,slot:breakable.slot};
    Object.assign(breakable,T.changeType(stage,breakable,enemy));
    const withEnemy=S.buildOverlay(stage,true);
    const reparsed=S.parseOverlay(withEnemy);
    assert.equal(reparsed.rooms[14].entityGfxId,3);
    const newBank=reparsed.entityLayouts.entities[reparsed.entityLayouts.indices[reparsed.rooms[14].entityLayoutId]];
    assert(newBank.some(entity=>entity.id===enemy.entity.id&&entity.x===originalPosition.x&&
      entity.y===originalPosition.y&&entity.slot===originalPosition.slot));
    const changes=await C.changedSectors(disc,record,source,withEnemy);
    assert(changes.length>0);
    const patch=new Uint8Array(await C.ppf3Blob(changes).arrayBuffer());
    assert.equal(Buffer.from(patch.subarray(0,5)).toString(),"PPF30");
    assert.deepEqual(source,original);
    console.log("Vanilla US CAT room 14 graphics change passed (source BIN read-only).");
  }finally{
    await fileHandle.close();
  }
}

verifyVanillaCatRoomChange().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
