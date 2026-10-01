const assert = require("assert");
const S = require("../disc-stage.js");
const C = require("../sotn-core.js");

function put16(b,o,v){b[o]=v&255;b[o+1]=v>>>8&255;}
function put32(b,o,v){put16(b,o,v);put16(b,o+2,v>>>16);}
function entity(b,o,x,y,id){put16(b,o,x);put16(b,o+2,y);b[o+4]=id;}

(async()=>{
  const base=0x80180000,b=new Uint8Array(0x4000);
  put32(b,16,base+0x3000);put32(b,28,base+0x500);put32(b,32,base+0x190);
  b.set([0,0,0,0,0,0,0,0],0x3000);b[0x3008]=0x40;
  put32(b,0x150,base+0x1000);put32(b,0x154,base+0x300);
  put32(b,0x158,0);put16(b,0x15c,0);put16(b,0x15e,0);
  put32(b,0x190,base+0x150);put32(b,0x194,base+0x160);
  put32(b,0x300,base+0x400);put32(b,0x304,base+0x440);
  put32(b,0x308,base+0x480);put32(b,0x30c,base+0x4c0);
  b[0x400+1]=2;b[0x440+1]=0x37;b[0x480+1]=4;
  b[0x1000]=1;
  for(let i=0;i<53;i++) {
    put32(b,0x500+i*4,base+0x800);
    put32(b,0x500+53*4+i*4,base+0x900);
  }
  for(const o of [0x800,0x900]) {
    entity(b,o,-2,-2,0);entity(b,o+10,20,30,7);entity(b,o+20,-1,-1,0);
  }
  const stage=S.parseOverlay(b);
  assert.equal(stage.rooms.length,1);
  assert.equal(stage.layers[0].fg.data,`map:${base+0x1000}`);
  const tiledef=stage.tiledefs.get(base+0x300);
  assert.equal(tiledef.pages[1],2);
  assert.equal(tiledef.tiles[1],0x37);
  assert.equal(tiledef.cluts[1],4);
  assert.equal(stage.entityLayouts.entities[0][1].id,7);
  const map=stage.maps.get(base+0x1000);
  map.values[0]=9;map.dirty=true;
  stage.entityLayouts.entities[0][1].x=44;
  const after=S.buildOverlay(stage,true);
  assert.equal(after[0x1000],9);
  const reparsed=S.parseOverlay(after);
  const changedIndex=reparsed.entityLayouts.indices[0];
  const unchangedIndex=reparsed.entityLayouts.indices[1];
  assert.equal(reparsed.entityLayouts.entities[changedIndex][1].x,44);
  assert.equal(reparsed.entityLayouts.entities[unchangedIndex][1].x,20);
  assert.notEqual(reparsed.xPtrs[0],reparsed.xPtrs[1]);
  assert.equal(b[0x1000],1);
  const noLayoutPointer=b.slice();put32(noLayoutPointer,28,0);
  assert.equal(S.parseOverlay(noLayoutPointer).entityLayouts.entities[0][1].id,7);

  const original=new Uint8Array(2048);original[3]=1;
  const modified=original.slice();modified[3]=9;
  const changes=[{start:4096,original,modified}];
  const ppf=new Uint8Array(await C.ppf3Blob(changes).arrayBuffer());
  assert.equal(Buffer.from(ppf.subarray(0,5)).toString(),"PPF30");
  assert.equal(ppf[5],2);assert.equal(ppf[59],0);
  const dv=new DataView(ppf.buffer);
  assert.equal(Number(dv.getBigUint64(60,true)),4099);
  assert.equal(ppf[68],1);assert.equal(ppf[69],9);
  const image=new Blob([new Uint8Array(6144)]);
  const built=new Uint8Array(await C.modifiedBlob(image,changes).arrayBuffer());
  assert.equal(built[4099],9);
  console.log("Disc stage and PPF3 tests passed.");
})().catch(e=>{console.error(e);process.exitCode=1;});
