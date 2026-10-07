const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), S = require('../../disc-stage.js');
const {repair} = require('./reverse-caverns-drops.js');
const source = process.env.SOTN_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
if (!directory) throw Error('Supply an output directory.');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Reverse-Caverns-Pot-Drops-ASS-2.0.ppf', 'Undo-Reverse-Caverns-Pot-Drops-ASS-2.0.ppf'];

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
  const record=await disc.findPath(['ST','RNO4','RNO4.BIN']),before=await disc.readFile(record);
  const stage=S.parseOverlay(before);stage.code='RNO4';
  const edits=repair(stage),after=S.buildOverlay(stage,true);
  const changes=await C.changedSectors(disc,record,before,after),work=Buffer.from(original);
  for(const change of changes){assert.deepEqual(C.repairSector(change.modified.slice(),24),change.modified);work.set(change.modified,change.start);}
  const finalHash=sha(work),block=original.subarray(0x9320,0x9720);
  const forward=ppf(changes,block,'Fix Reverse Caverns pot drops - ASS 2.0');
  const reverse=ppf(changes.map(c=>({...c,original:c.modified,modified:c.original})),block,'Undo Reverse Caverns pot drops - ASS 2.0');
  apply(work,reverse);assert.equal(sha(work),initialHash);
  apply(work,forward);assert.equal(sha(work),finalHash);
  apply(work,forward,true);assert.equal(sha(work),initialHash);
  apply(work,reverse,true);assert.equal(sha(work),finalHash);
  const starts=new Set(changes.map(c=>c.start));
  for(let at=0;at<work.length;at+=2352)if(!starts.has(at))assert.deepEqual(work.subarray(at,at+2352),original.subarray(at,at+2352));
  apply(work,reverse);work[A.parsePpf(forward).offsets[0]]^=1;assert.throws(()=>apply(work,forward));
  assert.equal(sha(await fs.readFile(source)),initialHash);
  const changedOffsets=[];for(let i=0;i<after.length;i++)if(after[i]!==before[i])changedOffsets.push('0x'+i.toString(16).toUpperCase());
  const report={
    source:{path:source,size:original.length,sha256:initialHash},result:{sha256:finalHash},
    forward:{path:path.resolve(directory,names[0]),sha256:sha(forward),size:forward.length},
    reversal:{path:path.resolve(directory,names[1]),sha256:sha(reverse),size:reverse.length},
    overlay:{path:'ST/RNO4/RNO4.BIN',extent:record.extent,size:record.size,prizeTableOffset:'0x1620',prizeTableLength:32},
    edits,changedOffsets,sectors:changes.map(c=>c.start/2352),records:A.parsePpf(forward).offsets.length,
    verified:['forward','reversal','forward undo','reversal undo','guarded rejection','sector checksums','unrelated sectors unchanged','source unchanged'],
    gameplay:'Fresh-boot gameplay and pickup artwork remain unverified; actual persistent-drop instructions passed simulated pickup/save-flag checks.',
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git',revision:'e1677235c24e53af9b84f44ea18af4f85813ed62',files:['src/st/rno4/unk_44B0C.c','src/st/rno4/d_prize_drops.c','src/st/e_collect.h']},
    otherExistingInvalidPots:[{room:9,x:76,y:97,params:0x70BE,slot:190,status:'Outside screenshot rooms; unchanged.'}],
    application:{applied:false}
  };
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(report.forward.path,forward);await fs.writeFile(report.reversal.path,reverse);
  await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(path.join(directory,'README.md'),`# Reverse Caverns pot drops\n\nRoom 6 (32, 881) now gives Ham and eggs from slot 22. Room 7 uses slots 27–31 for three Heart Max-Ups and two Life Max-Ups, with independent collected flags. Pot artwork, positions, and unrelated pickups are preserved. No source BIN or backup is created during preparation.\n\nThe editor previously treated these urn parameters as direct item IDs. Both urn and jug branches actually create a persistent drop from a prize-table slot. Slot 176 is outside the 32-entry table; slots 12 and 23 belong to other pickups and may already be collected. The repair uses unused slots and keeps those existing pickups intact.\n\nBefore SHA-256: ${initialHash}\n\nAfter SHA-256: ${finalHash}\n\nForward SHA-256: ${sha(forward)}\n\nReversal SHA-256: ${sha(reverse)}\n\nSee verification.json for the source path, revision, guarded offsets, sectors, checks, and application status. Apply only after explicit approval, using the builder with --apply and this output directory. Its guards require the exact source hash and bytes. Standard PPF patchers may not enforce every guard.\n\nTests execute the actual persistent-drop routine with prior slots 12 and 23 collected: all six new pickups remain available, collection marks only the matching slot, and that pickup alone disappears on re-entry. Export/reopen, both placement copies, saved edits/Undo, and unrelated bytes pass checks. This is static instruction verification, not emulator gameplay. Fresh-boot the patched image and load a memory-card save; old savestates retain the old overlay.\n`);
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
