const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), S = require('../../disc-stage.js');
const {repair, STAGES} = require('./maxup-pickups.js');
const source = process.env.SOTN_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
if (!directory) throw Error('Supply an output directory.');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Unique-MaxUp-Pickups-ASS-2.0.ppf', 'Undo-Unique-MaxUp-Pickups-ASS-2.0.ppf'];

function ppf(changes, block, description) {
  const header = Buffer.alloc(60);header.write('PPF30');header[5]=2;
  header.fill(32,6,56);header.write(description.slice(0,50),6,'ascii');header[57]=header[58]=1;
  const parts=[header,block];
  for(const {start,original,modified} of changes)for(let i=0;i<modified.length;) {
    if(original[i]===modified[i]){i++;continue;}
    const first=i;while(i<modified.length&&original[i]!==modified[i]&&i-first<255)i++;
    const record=Buffer.alloc(9);record.writeBigUInt64LE(BigInt(start+first));record[8]=i-first;
    parts.push(record,modified.slice(first,i),original.slice(first,i));
  }
  return Buffer.concat(parts);
}
function apply(image,patch,undo=false) {
  const p=A.parsePpf(patch);
  assert.deepEqual(image.subarray(0x9320,0x9720),Buffer.from(p.blockCheck));
  p.offsets.forEach((offset,i)=>{
    const size=p.lengths[i],at=p.data[i];
    assert.deepEqual(image.subarray(offset,offset+size),Buffer.from(p.bytes.subarray(at+(undo?0:size),at+(undo?size:size*2))));
  });
  p.offsets.forEach((offset,i)=>{
    const size=p.lengths[i],at=p.data[i];image.set(p.bytes.subarray(at+(undo?size:0),at+(undo?size*2:size)),offset);
  });
  return image;
}
(async()=>{
  const reportPath=path.join(directory,'verification.json');
  if(applying) {
    const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
    assert.equal(path.resolve(source),path.resolve(report.source.path));
    const image=await fs.readFile(source);assert.equal(sha(image),report.source.sha256,'The source BIN changed.');
    const forward=await fs.readFile(report.forward.path),reverse=await fs.readFile(report.reversal.path);
    assert.equal(sha(forward),report.forward.sha256);assert.equal(sha(reverse),report.reversal.sha256);
    apply(image,forward);assert.equal(sha(image),report.result.sha256);
    apply(image,reverse);assert.equal(sha(image),report.source.sha256);
    apply(image,reverse,true);assert.equal(sha(image),report.result.sha256);
    const handle=await fs.open(source,'r+');
    try {
      for(const sector of report.sectors) {
        const at=sector*2352,bytes=image.subarray(at,at+2352);
        assert.deepEqual(C.repairSector(bytes.slice(),24),bytes);
        assert.equal((await handle.write(bytes,0,bytes.length,at)).bytesWritten,bytes.length);
      }
      await handle.sync();
    } finally {await handle.close();}
    const live=await fs.readFile(source);assert.equal(sha(live),report.result.sha256);
    for(const sector of report.sectors) {
      const bytes=live.subarray(sector*2352,(sector+1)*2352);assert.deepEqual(C.repairSector(bytes.slice(),24),bytes);
    }
    apply(live,reverse);assert.equal(sha(live),report.source.sha256);
    report.application={applied:true,liveSha256:report.result.sha256,reversalVerified:true};
    await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.application));return;
  }
  const original=await fs.readFile(source),initialHash=sha(original);
  const disc=await C.DiscImage.open(new Blob([original]));assert.equal(disc.sectorSize,2352);
  const changes=[],edits=[],overlays=[];
  for(const code of Object.keys(STAGES)) {
    const record=await disc.findPath(['ST',code,`${code}.BIN`]),before=await disc.readFile(record);
    const stage=S.parseOverlay(before);stage.code=code;
    edits.push(...repair(stage));
    const after=S.buildOverlay(stage,true),changedOffsets=[];
    for(let i=0;i<after.length;i++)if(after[i]!==before[i])changedOffsets.push('0x'+i.toString(16).toUpperCase());
    overlays.push({path:`ST/${code}/${code}.BIN`,extent:record.extent,size:record.size,changedOffsets});
    changes.push(...await C.changedSectors(disc,record,before,after));
  }
  changes.sort((a,b)=>a.start-b.start);
  const work=Buffer.from(original);
  for(const change of changes){assert.deepEqual(C.repairSector(change.modified.slice(),24),change.modified);work.set(change.modified,change.start);}
  const finalHash=sha(work),block=original.subarray(0x9320,0x9720);
  const forward=ppf(changes,block,'Unique Max-Up pickups - ASS 2.0');
  const reverse=ppf(changes.map(c=>({...c,original:c.modified,modified:c.original})),block,'Undo unique Max-Up pickups - ASS 2.0');
  apply(work,reverse);assert.equal(sha(work),initialHash);
  apply(work,forward);assert.equal(sha(work),finalHash);
  apply(work,forward,true);assert.equal(sha(work),initialHash);
  apply(work,reverse,true);assert.equal(sha(work),finalHash);
  const starts=new Set(changes.map(c=>c.start));
  for(let at=0;at<work.length;at+=2352)if(!starts.has(at))assert.deepEqual(work.subarray(at,at+2352),original.subarray(at,at+2352));
  apply(work,reverse);work[A.parsePpf(forward).offsets[0]]^=1;assert.throws(()=>apply(work,forward));
  assert.equal(sha(await fs.readFile(source)),initialHash);
  const report={
    source:{path:source,size:original.length,sha256:initialHash},result:{sha256:finalHash},
    forward:{path:path.resolve(directory,names[0]),sha256:sha(forward),size:forward.length},
    reversal:{path:path.resolve(directory,names[1]),sha256:sha(reverse),size:reverse.length},
    overlays,edits:edits.map(e=>({...e,flag:'0x'+e.flag.toString(16).toUpperCase()})),
    sectors:changes.map(c=>c.start/2352),records:A.parsePpf(forward).offsets.length,
    verified:['forward','reversal','forward undo','reversal undo','guarded rejection','sector checksums','unrelated sectors unchanged','source unchanged'],
    gameplay:'Emulator gameplay remains unverified; tests run the real candle and persistent-drop instructions.',
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git',revision:'0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',
      files:['src/st/e_collect.h','src/st/st_common.h','src/st/e_breakable.h','src/st/no4/48248.c','src/dra/5087C.c']},
    editor:{remote:'D:/AAA/GitHub/sotn-editor',revision:process.env.EDITOR_REVISION||null},
    application:{applied:false}
  };
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(report.forward.path,forward);await fs.writeFile(report.reversal.path,reverse);
  await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  const rows=report.edits.map(e=>`| ${e.code} | ${e.room} | ${e.x}, ${e.y} | ${e.item===12?'Heart':'Life'} Max-Up | 0x${e.from.toString(16).toUpperCase()} → 0x${e.to.toString(16).toUpperCase()} | ${e.slot} | ${e.flag} |`).join('\n');
  await fs.writeFile(path.join(directory,'README.md'),`# Unique Max-Up pickups\n\nEvery edited Max-Up gets its own prize slot and collected flag.\n\n- **Castle Entrance (NO3, and NP3 for later visits)**: room 14 used slot 0, shared with room 0. It now uses slot 3, which already held a Heart Max-Up and was unused.\n- **Underground Caverns (NO4)**: two room 25 pickups shared slot 0 with room 8. They now use unused slots 3 and 8, set to Heart Max-Up.\n- **Death Wing's Lair (RNO2)**: four candles named the item directly, so they had no collected flag and refilled on every room re-entry. Candles cannot use prize slots, so each is now a persistent Max-Up pickup at the same position (flags 0, spawn ID 0, entity slot kept, as the editor's Change Type does), using unused slots 1–4. Each is collected once.\n\n| Stage | Room | Position | Item | Params | Slot | Flag |\n|---|---:|---|---|---|---:|---|\n${rows}\n\nNo other pickup moves. Slots in use, NO4's scripted Succubus slot 10, and the BO3 (Scylla) mirror of NO4 slots 2, 13, 14 and 21 are unchanged.\n\nOn an existing save, a Max-Up that was hidden because its shared twin was collected becomes available. Collected flags are not reset.\n\nBefore SHA-256: ${initialHash}\n\nAfter SHA-256: ${finalHash}\n\nForward SHA-256: ${sha(forward)}\n\nReversal SHA-256: ${sha(reverse)}\n\nSee verification.json for revisions, offsets, sectors and application status. Apply only after explicit approval, with this builder, the same directory and --apply. Fresh-boot the patched image and load a memory-card save. Old savestates keep the old overlays.\n`);
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
