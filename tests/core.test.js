const assert = require("assert");
const C = require("../sotn-core.js");

function put16(b,o,v){b[o]=v&255;b[o+1]=(v>>8)&255;}
function put32(b,o,v){b[o]=v&255;b[o+1]=(v>>8)&255;b[o+2]=(v>>16)&255;b[o+3]=(v>>24)&255;}
function dirRecord(name, extent, size, isDir=false) {
  const nb = typeof name === "number" ? Buffer.from([name]) : Buffer.from(name,"ascii");
  let len = 33 + nb.length; if (len & 1) len++;
  const b = Buffer.alloc(len); b[0]=len; put32(b,2,extent); put32(b,6,extent); put32(b,10,size); put32(b,14,size);
  b[25]=isDir?2:0; b[28]=1;b[31]=1;b[32]=nb.length; nb.copy(b,33); return b;
}

(async()=>{
  // 4bpp page decode + palette/tile rendering
  const stage = new Uint8Array(0x8000);
  stage[0] = 0x21; // pixel 0 index 1, pixel 1 index 2
  const po = C.paletteOffset(0);
  put16(stage,po+2,0x001F); // palette 1 = red
  put16(stage,po+4,0x03E0); // palette 2 = green
  const pages=C.decodeStagePages(stage);
  assert.equal(pages.length,1);
  assert.equal(pages[0][0],1); assert.equal(pages[0][1],2);

  const td={tiles:new Uint8Array(2),pages:new Uint8Array(2),cluts:new Uint8Array(2)};
  td.tiles[1]=0;td.pages[1]=0;td.cluts[1]=0;
  const rgba=C.renderTileRGBA(stage,pages,td,1,false);
  assert.ok(rgba);
  assert.equal(rgba[0],248); assert.equal(rgba[1],0); assert.equal(rgba[2],0); assert.equal(rgba[3],255);
  assert.equal(rgba[4],0); assert.equal(rgba[5],248); assert.equal(rgba[6],0); assert.equal(rgba[7],255);

  // Synthetic ISO9660 image to test disc navigation/extraction.
  const SECTOR=2048, iso=Buffer.alloc(SECTOR*40);
  const pvd=16*SECTOR; iso[pvd]=1; Buffer.from("CD001").copy(iso,pvd+1); iso[pvd+6]=1;
  const rootRec=dirRecord(0,20,SECTOR,true); rootRec.copy(iso,pvd+156);
  const term=17*SECTOR; iso[term]=255; Buffer.from("CD001").copy(iso,term+1); iso[term+6]=1;

  let off=20*SECTOR;
  const dot=dirRecord(0,20,SECTOR,true), dotdot=dirRecord(1,20,SECTOR,true), st=dirRecord("ST",21,SECTOR,true);
  dot.copy(iso,off);off+=dot.length;dotdot.copy(iso,off);off+=dotdot.length;st.copy(iso,off);

  off=21*SECTOR;
  const d1=dirRecord(0,21,SECTOR,true), d2=dirRecord(1,20,SECTOR,true), no3=dirRecord("NO3",22,SECTOR,true);
  d1.copy(iso,off);off+=d1.length;d2.copy(iso,off);off+=d2.length;no3.copy(iso,off);

  off=22*SECTOR;
  const n1=dirRecord(0,22,SECTOR,true), n2=dirRecord(1,21,SECTOR,true), gfx=dirRecord("F_NO3.BIN;1",23,4,false),overlay=dirRecord("NO3.BIN;1",24,4,false);
  n1.copy(iso,off);off+=n1.length;n2.copy(iso,off);off+=n2.length;gfx.copy(iso,off);off+=gfx.length;overlay.copy(iso,off);
  Buffer.from([1,2,3,4]).copy(iso,23*SECTOR);
  Buffer.from([5,6,7,8]).copy(iso,24*SECTOR);

  const blob = new Blob([iso]);
  const disc=await C.DiscImage.open(blob);
  const got=await disc.findStageGraphics("NO3");
  assert.deepEqual(Array.from(got.bytes),[1,2,3,4]);
  const stages=await disc.listStages();
  assert.equal(stages.length,1);
  assert.equal(stages[0].code,"NO3");
  const before=await disc.readFile(stages[0].overlay),after=before.slice();after[1]=42;
  const changed=await C.changedSectors(disc,stages[0].overlay,before,after);
  assert.equal(changed.length,1);
  assert.equal(changed[0].modified[1],42);

  const raw=Buffer.alloc(2352*40);
  for(let i=0;i<40;i++){
    const base=i*2352;raw[base+15]=2;
    iso.copy(raw,base+24,i*SECTOR,(i+1)*SECTOR);
  }
  const rawDisc=await C.DiscImage.open(new Blob([raw]));
  const rawStages=await rawDisc.listStages();
  const rawBefore=await rawDisc.readFile(rawStages[0].overlay),rawAfter=rawBefore.slice();rawAfter[1]=42;
  const rawChanged=await C.changedSectors(rawDisc,rawStages[0].overlay,rawBefore,rawAfter);
  assert.equal(rawChanged[0].modified[24+1],42);
  assert.equal(rawChanged[0].modified[15],2);
  assert.notDeepEqual(rawChanged[0].modified.subarray(2072),rawChanged[0].original.subarray(2072));

  console.log("All SOTN core tests passed.");
})().catch(e=>{console.error(e);process.exit(1);});
