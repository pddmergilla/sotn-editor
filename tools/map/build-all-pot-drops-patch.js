const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), S = require('../../disc-stage.js');
const {repair,specs} = require('./all-pot-drops.js');
const {audit} = require('./audit-pot-drops.js');
const source = process.env.SOTN_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
if (!directory) throw Error('Supply an output directory.');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['All-Pot-Drops-ASS-2.0.ppf', 'Undo-All-Pot-Drops-ASS-2.0.ppf'];

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
  const beforeAudit=await audit(disc),overlays=new Map(),overlayReports=[],changes=[];
  assert.equal(beforeAudit.stages.filter(s=>s.error).length,0);
  assert.equal(beforeAudit.issues.length,8,'The pot audit changed.');
  for(const [code,spec]of Object.entries(specs)){
    const record=await disc.findPath(['ST',code,code+'.BIN']),before=await disc.readFile(record);
    const stage=S.parseOverlay(before);stage.code=code;
    const edits=repair(stage),after=S.buildOverlay(stage,true);overlays.set(code,after);
    changes.push(...await C.changedSectors(disc,record,before,after));
    const changedOffsets=[];for(let i=0;i<after.length;i++)if(after[i]!==before[i])changedOffsets.push('0x'+i.toString(16).toUpperCase());
    overlayReports.push({path:`ST/${code}/${code}.BIN`,extent:record.extent,size:record.size,prizeTableOffset:spec.offset,prizeTableLength:S.prizeTableLength(stage,0),edits,changedOffsets});
  }
  const afterAudit=await audit(disc,overlays);assert.equal(afterAudit.pots.length,beforeAudit.pots.length);
  assert.deepEqual(afterAudit.issues,[]);assert.equal(afterAudit.stages.filter(s=>s.error).length,0);
  changes.sort((a,b)=>a.start-b.start);assert.equal(new Set(changes.map(c=>c.start)).size,changes.length);
  const work=Buffer.from(original);
  for(const change of changes){assert.deepEqual(C.repairSector(change.modified.slice(),24),change.modified);work.set(change.modified,change.start);}
  const finalHash=sha(work),block=original.subarray(0x9320,0x9720);
  const forward=ppf(changes,block,'Fix all unsafe pot drops - ASS 2.0');
  const reverse=ppf(changes.map(c=>({...c,original:c.modified,modified:c.original})),block,'Undo all unsafe pot drops - ASS 2.0');
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
    overlays:overlayReports,sectors:changes.map(c=>c.start/2352),records:A.parsePpf(forward).offsets.length,
    audit:{overlays:beforeAudit.stages.length,breakables:beforeAudit.pots.length,beforeIssues:beforeAudit.issues.length,afterIssues:afterAudit.issues.length,excluded:beforeAudit.stages.filter(s=>s.excluded)},
    verified:['forward','reversal','forward undo','reversal undo','guarded rejection','sector checksums','unrelated sectors unchanged','source unchanged'],
    gameplay:'Fresh-boot gameplay and pickup artwork remain unverified; actual breakable and persistent-drop instructions passed simulated pickup/save-flag checks.',
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git',revision:'0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',files:['src/st/rno2/unk_322E4.c','src/st/rlib/unk_20AE8.c','src/st/rno4/unk_44B0C.c','src/st/e_collect.h']},
    application:{applied:false}
  };
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(report.forward.path,forward);await fs.writeFile(report.reversal.path,reverse);
  await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(path.join(directory,'before-audit.json'),JSON.stringify(beforeAudit,null,2)+'\n');
  await fs.writeFile(path.join(directory,'after-audit.json'),JSON.stringify(afterAudit,null,2)+'\n');
  await fs.writeFile(path.join(directory,'README.md'),`# All pot drops\n\nAudited ${beforeAudit.pots.length} breakable placements across all ${beforeAudit.stages.length} overlays, both room placement copies. The file-select menu has no stage rooms; the five test overlays and BO0 have no placed breakables. All placed breakable drop branches resolved from the live instructions. Eight remaining unsafe pots are repaired; the earlier six-pot Reverse Caverns repair stays intact.\n\n${overlayReports.flatMap(s=>s.edits.map(t=>'- '+s.path+' Room '+t.room+' ('+t.x+', '+t.y+'): '+t.name+'; slot '+t.slot)).join('\n')}\n\nArtwork, positions, existing pickups and unrelated sectors are preserved. RNO2 slots 0–5 are unused by current placements or scripted persistent spawns; its existing pickups use 6–11. RLIB's scripted shelf drop uses slot 6, so it is preserved. Each repaired pot has an independent flag. Old saves that already collected these formerly unused slots can still hide a pickup; the patch does not reset save progress.\n\nSource: ${source}\n\nBefore SHA-256: ${initialHash}\n\nAfter SHA-256: ${finalHash}\n\nForward SHA-256: ${sha(forward)}\n\nReversal SHA-256: ${sha(reverse)}\n\nSee verification.json for exact offsets, source revision, sector checks and application status. Forward, reverse and both undo directions reproduce the full expected image hashes; mismatched bytes are rejected. Preparation leaves the source BIN unchanged and creates no backup BIN. Apply only after approval using the builder with --apply and this directory.\n\nThe editor now recognizes RNO2 urns/jugs, RLIB urns/jugs/busts and BO3 urns/fixed jugs, and bounds the affected prize tables. The after audit reports zero unsafe pot drops or rule mismatches. Simulated live instructions check every pot's break branch and the repaired pickups' collection flags; browser editing/export and saved-edit Undo are checked separately. Fresh-boot gameplay and artwork still need emulator validation using a memory-card save, not an old savestate.\n`);
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
