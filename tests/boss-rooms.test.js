const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const C=require("../sotn-core.js"),S=require("../disc-stage.js"),E=require("../edit-session.js");
const codes=["BO0","BO1","BO2","BO3","BO4","BO5","BO6","BO7","MAR","RBO0","RBO1","RBO2","RBO3","RBO4","RBO5","RBO6","RBO7","RBO8"];
const downloads=path.join(os.homedir(),"Downloads");
const images=[process.env.SOTN_BIN||path.join(downloads,"Castlevania - Alternate Scarlet Symphony 2.0.bin"),
  process.env.SOTN_VANILLA_BIN||path.join(downloads,"Castlevania - Symphony of the Night (USA)","Castlevania - Symphony of the Night (USA) (Track 1).bin")];
async function hash(file){const h=crypto.createHash("sha256");for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest("hex");}
async function checkImage(filePath){
  const beforeHash=await hash(filePath),handle=await fs.promises.open(filePath,"r");
  try{
    const file={size:(await handle.stat()).size,slice(start,end){return {async arrayBuffer(){
      const bytes=Buffer.alloc(end-start),read=await handle.read(bytes,0,bytes.length,start);
      assert.equal(read.bytesRead,bytes.length);return bytes.buffer;
    }};}};
    const disc=await C.DiscImage.open(file),catalog=await disc.listStages(),bosses=catalog.filter(a=>a.directory==="BOSS");
    assert.deepEqual(bosses.map(a=>a.code).sort(),codes.slice().sort());
    for(const area of bosses){
      const source=await disc.readFile(area.overlay),stage=S.parseOverlay(source);stage.code=area.code;
      assert.deepEqual(S.buildOverlay(stage),source,`${area.code}: unchanged map`);
      const graphics=await disc.findStageGraphics(area.code);
      assert.equal(graphics.record.extent,area.gfx.extent);
      const pages=C.decodeStagePages(graphics.bytes);
      const room=stage.rooms.find(r=>stage.layers[r.layerId]?.fg);
      assert.ok(room,`${area.code}: editable room`);
      const layer=stage.layers[room.layerId].fg,map=stage.maps.get(Number(layer.data.split(":")[1])),td=stage.tiledefs.get(Number(layer.tiledef.split(":")[1]));
      const tileIndex=Array.from(map.values).findIndex(v=>v>0&&v<td.tiles.length);
      assert.ok(tileIndex>=0,`${area.code}: visible tile`);
      assert.ok(C.renderTileRGBA(graphics.bytes,pages,td,map.values[tileIndex],!!(layer.flags&0x200)),`${area.code}: tile artwork`);
      const originalTile=map.values[tileIndex],replacement=originalTile===1?2:1;
      map.values[tileIndex]=replacement;map.dirty=true;
      const originalCollision=td.collisions[replacement];td.collisions[replacement]=originalCollision^1;td.dirty=true;
      const built=S.buildOverlay(stage),allowed=new Set([map.offset+tileIndex*2,map.offset+tileIndex*2+1,td.offsets[3]+replacement]);
      for(let i=0;i<source.length;i++)if(source[i]!==built[i])assert.ok(allowed.has(i),`${area.code}: unrelated byte ${i}`);
      const saved=E.parse(JSON.stringify(await E.capture({name:path.basename(filePath),area:area.code,stages:new Map([[area.code,stage]])})));
      const fresh=S.parseOverlay(source);fresh.code=area.code;
      const undo=(await E.prepare(saved,{stages:new Map([[area.code,fresh]])})).apply();
      assert.deepEqual(S.buildOverlay(fresh),built,`${area.code}: saved edits restore`);
      undo();assert.deepEqual(S.buildOverlay(fresh),source,`${area.code}: undo restore`);
      const changes=await C.changedSectors(disc,area.overlay,source,built);
      assert.ok(changes.length>0);
      const replay=new Map(changes.map(change=>[change.start,change.original.slice()]));
      const ppf=new Uint8Array(await C.ppf3Blob(changes).arrayBuffer()),view=new DataView(ppf.buffer);
      for(let at=60;at<ppf.length;){
        const start=Number(view.getBigUint64(at,true)),length=ppf[at+8];at+=9;
        const sectorStart=Math.floor(start/disc.sectorSize)*disc.sectorSize;
        assert.ok(replay.has(sectorStart),`${area.code}: patch stays inside changed sectors`);
        replay.get(sectorStart).set(ppf.subarray(at,at+length),start-sectorStart);at+=length;
      }
      for(const change of changes){
        assert.ok(change.start>=area.overlay.extent*disc.sectorSize&&change.start<(area.overlay.extent+Math.ceil(area.overlay.size/2048))*disc.sectorSize);
        assert.deepEqual(replay.get(change.start),change.modified,`${area.code}: PPF replay`);
        const repaired=change.modified.slice();C.repairSector(repaired,disc.dataOffset);
        assert.deepEqual(repaired,change.modified,`${area.code}: sector checksums`);
      }
      assert.deepEqual(await disc.readFile(area.overlay),source,`${area.code}: source preservation`);
    }
    assert.equal(await hash(filePath),beforeHash);
    console.log(`${path.basename(filePath)}: all 18 boss overlays passed artwork, isolated tile/collision edits, saved edits, Undo, PPF replay, checksums and source preservation.`);
  }finally{await handle.close();}
}
(async()=>{
  for(const file of [...new Set(images)]){
    if(fs.existsSync(file))await checkImage(file);else console.log(`Boss image checks skipped: ${file}`);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
