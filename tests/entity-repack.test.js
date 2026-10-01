const assert=require("assert");
const S=require("../disc-stage.js");

const BASE=0x80180000;
const SIZE=10;

function put16(b,o,v){b[o]=v&255;b[o+1]=v>>>8&255;}
function put32(b,o,v){put16(b,o,v);put16(b,o+2,v>>>16);}
function putEntity(b,o,e){
  put16(b,o,e.x);put16(b,o+2,e.y);b[o+4]=e.id;b[o+5]=e.flags;
  b[o+6]=e.slot;b[o+7]=e.spawnId;put16(b,o+8,e.params);
}
function writeBank(b,o,entities,axis){
  const ordered=entities.map((entry,index)=>({entry,index})).sort((a,c)=>
    a.entry[axis]-c.entry[axis]||a.index-c.index).map(item=>item.entry);
  putEntity(b,o,{x:-2,y:-2,id:0,flags:0,slot:0,spawnId:0,params:0});
  ordered.forEach((entry,index)=>putEntity(b,o+(index+1)*SIZE,entry));
  putEntity(b,o+(ordered.length+1)*SIZE,{x:-1,y:-1,id:0,flags:0,slot:0,spawnId:0,params:0});
}
function makeFixture(duplicates=true){
  const b=new Uint8Array(0x4000),a=0x800,bx=0x830,c=0x860,d=0x890;
  put32(b,16,BASE+0x3000);put32(b,28,BASE+0x500);put32(b,32,BASE+0x190);
  b[0x3008]=0x40;
  put32(b,0x150,BASE+0x1000);put32(b,0x154,BASE+0x300);
  put32(b,0x158,0);put16(b,0x15c,0);put16(b,0x15e,0);
  put32(b,0x190,BASE+0x150);put32(b,0x194,BASE+0x160);
  put32(b,0x300,BASE+0x400);put32(b,0x304,BASE+0x440);
  put32(b,0x308,BASE+0x480);put32(b,0x30c,BASE+0x4c0);
  b[0x1000]=1;
  let first,second;
  if(duplicates){
    first=[
      {x:-300,y:100,id:11,flags:0x22,slot:3,spawnId:7,params:0x1111},
      {x:100,y:200,id:12,flags:0x33,slot:4,spawnId:8,params:0x2222}
    ];
    second=[
      {x:-100,y:-250,id:21,flags:0x44,slot:5,spawnId:9,params:0x3333},
      {x:300,y:-100,id:22,flags:0x55,slot:6,spawnId:10,params:0x4444}
    ];
  }else{
    first=[
      {x:-300,y:200,id:11,flags:0x22,slot:3,spawnId:7,params:0x1111},
      {x:100,y:100,id:12,flags:0x33,slot:4,spawnId:8,params:0x2222}
    ];
    second=[
      {x:-100,y:-100,id:21,flags:0x44,slot:5,spawnId:9,params:0x3333},
      {x:300,y:-200,id:22,flags:0x55,slot:6,spawnId:10,params:0x4444}
    ];
  }
  writeBank(b,a,first,"x");writeBank(b,bx,second,"x");
  writeBank(b,c,first,"y");writeBank(b,d,second,"y");
  for(let i=0;i<53;i++){
    const group=i<26?0:1;
    put32(b,0x500+i*4,BASE+(group===0?a:bx));
    put32(b,0x500+53*4+i*4,BASE+(group===0?c:d));
  }
  return {bytes:b,stage:S.parseOverlay(b)};
}
function addEntity(stage,entity){
  const entries=stage.entityLayouts.entities[0];
  entries.splice(entries.length-1,0,entity);
}
function sourceFields(e){
  return {x:e.x,y:e.y,id:e.id,flags:e.flags,slot:e.slot,spawnId:e.spawnId,params:e.params};
}

{
  const {bytes,stage}=makeFixture(true),source=bytes.slice(),stageSource=stage.bytes.slice();
  assert.equal(stage.layoutPtr,BASE+0x500);
  assert.equal(S.entityRepackCapacity(stage),1);
  const added={x:-500,y:150,id:99,flags:0xA5,slot:0x16,spawnId:0x82,params:0xBEEF};
  addEntity(stage,added);
  assert.equal(S.entityRepackCapacity(stage),0);
  const built=S.buildOverlay(stage,true);
  assert.deepEqual(bytes,source);
  assert.deepEqual(stage.bytes,stageSource);
  assert.equal(S.parseOverlay(built).layoutPtr,BASE+0x500);

  const reparsed=S.parseOverlay(built);
  assert.equal(reparsed.xPtrs[0],BASE+0x800);
  assert.equal(reparsed.yPtrs[0],BASE+0x832);
  assert.equal(reparsed.xPtrs[26],reparsed.yPtrs[26]);
  assert.notEqual(reparsed.xPtrs[26],BASE+0x830);
  assert.notEqual(reparsed.xPtrs[0],reparsed.xPtrs[1]);
  assert.equal(reparsed.entityLayouts.entities[1].length,4);
  assert.deepEqual(reparsed.entityLayouts.entities[0].slice(1,-1).map(e=>e.x),[-500,-300,100]);
  assert.deepEqual(reparsed.banks.get(reparsed.yPtrs[0]).entries.slice(1,-1).map(e=>e.y),[100,150,200]);
  assert.deepEqual(sourceFields(reparsed.entityLayouts.entities[0][1]),added);

  const tableStart=0x500,tableEnd=tableStart+53*8,spanStart=0x800,spanEnd=0x8B8;
  for(let i=0;i<built.length;i++){
    const editable=(i>=tableStart&&i<tableEnd)||(i>=spanStart&&i<spanEnd);
    if(!editable)assert.equal(built[i],source[i],`unexpected byte change at 0x${i.toString(16)}`);
  }
}

{
  const {bytes,stage}=makeFixture(true),source=bytes.slice();
  assert.equal(S.entityRepackCapacity(stage),1);
  addEntity(stage,{x:-500,y:150,id:90,flags:1,slot:2,spawnId:3,params:4});
  addEntity(stage,{x:500,y:250,id:91,flags:5,slot:6,spawnId:7,params:8});
  assert.equal(S.entityRepackCapacity(stage),0);
  assert.throws(()=>S.buildOverlay(stage,true),/exceed the original span/);
  assert.deepEqual(bytes,source);
  assert.deepEqual(stage.bytes,source);
}

{
  const {bytes,stage}=makeFixture(false);
  bytes[0x828]=1;
  const unsafe=S.parseOverlay(bytes);
  assert.equal(S.entityRepackCapacity(unsafe),0);
  addEntity(unsafe,{x:-500,y:150,id:92,flags:1,slot:2,spawnId:3,params:4});
  assert.throws(()=>S.buildOverlay(unsafe,true),/bytes between entity banks are not zero/);
}

{
  const {bytes}=makeFixture(false);
  put32(bytes,0x2000,BASE+0x800);
  const unsafe=S.parseOverlay(bytes);
  assert.equal(S.entityRepackCapacity(unsafe),0);
}

console.log("Entity repack tests passed.");
