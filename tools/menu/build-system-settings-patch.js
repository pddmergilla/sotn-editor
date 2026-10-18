const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const H = require('./system-settings.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const {verify} = require('../../tests/system-settings.test.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const directory = process.argv[2];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
const names = ['System-Settings-ASS-2.0.ppf', 'Reverse-System-Settings-ASS-2.0.ppf'];

async function inspect(image) {
  const disc = await C.DiscImage.open(new Blob([image]));
  assert.equal(disc.sectorSize, 2352);
  const record = await disc.findPath(['DRA.BIN']);
  return {disc, record, dra: await disc.readFile(record)};
}

function sectorsValid(image, sectors) {
  for (const sector of sectors) {
    const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
    assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes, `Sector ${sector}.`);
  }
}

async function main() {
  if(process.argv.includes('--slots')||process.argv.includes('--slot-description')||process.argv.includes('--item-slot-descriptions'))return slotMain();
  assert.ok(directory, 'Supply an output directory.');
  const reportPath = path.resolve(directory, 'verification.json');
  if (process.argv.includes('--apply')) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const original = await fs.readFile(source); assert.equal(sha(original), report.source.sha256, 'The source BIN changed; prepare a new patch pair.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    const image = Buffer.from(original); apply(image, forward); assert.equal(sha(image), report.result.sha256);
    sectorsValid(image, report.sectors);
    assert.deepEqual([...new Set(A.parsePpf(forward).offsets.map(off => Math.floor(off / 2352)))].sort((a, b) => a - b), report.sectors);
    const result = await inspect(image), before = await inspect(original);
    assert.deepEqual(result.dra, await verify(before.dra));
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    assert.equal(sha(await fs.readFile(source)), report.source.sha256, 'The live BIN changed before writing.');
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of report.sectors) {
        const start = sector * 2352, current = Buffer.alloc(2352);
        assert.equal((await handle.read(current, 0, 2352, start)).bytesRead, 2352);
        assert.deepEqual(current, original.subarray(start, start + 2352));
        assert.equal((await handle.write(image.subarray(start, start + 2352), 0, 2352, start)).bytesWritten, 2352);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256);
    sectorsValid(live, report.sectors);
    assert.deepEqual((await inspect(live)).dra, result.dra);
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const {disc, record, dra} = await inspect(original), after = await verify(dra);
  const changes = await C.changedSectors(disc, record, dra, after), sectors = changes.map(change => change.start / 2352).sort((a, b) => a - b);
  const image = Buffer.from(original); changes.forEach(change => image.set(change.modified, change.start));
  sectorsValid(image, sectors);
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Minimap toggle and remappable Item Shortcut');
  const reverse = ppf(changes.map(change => ({...change, original: change.modified, modified: change.original})), block, 'Reverse minimap toggle and Item Shortcut');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  assert.deepEqual((await inspect(image)).dra, after);
  const starts = new Set(changes.map(change => change.start));
  for (let at = 0; at < original.length; at += 2352) if (!starts.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  assert.equal(sha(await fs.readFile(source)), initial, 'Source changed during preparation.');
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length,
    behavior: {minimap: 'System row 7: Show minimap Yes/No; Left Yes, Right No, Cross toggle; Triangle back',
      itemShortcut: 'Button Config row 8; new-game default L2; existing saves retain their previously unused button',
      combinations: 'Shortcut + configured Right hand: Potion; Left hand: High Potion; Backdash: X-Potion; Jump: Meal Ticket',
      save: 'Uses existing buttonConfig[7], buttonMask[7] and castle flag 0x2FB; save-room persistence needs gameplay testing'},
    edits: {file: 'DRA.BIN', extent: record.extent, size: record.size, cave: '0x2F124-0x2F323, unused icons 316-319',
      helperBytes: H.helper().bytes.length, nativeGuards: H.NATIVE, ranges: []},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision(decomp),
      files: ['src/dra/menu.c', 'src/dra/game_handlers.c', 'src/dra/692E8.c', 'include/game.h'], dirty: true},
    editor: {revision: revision(path.join(__dirname, '../..')), dirty: true},
    verified: ['40320 valid button layouts', '56 duplicate layouts rejected', 'all eight rows drawn',
      'minimap controls and native minimap gate', '2048 remapped shortcut combinations', 'four action suppression',
      'forward/reversal and both embedded undo hashes', 'damaged-byte rejection', 'all changed sector checksums',
      'unchanged unrelated sectors', 'source unchanged', 'patched DRA export/reopen'],
    limitations: ['Fresh-boot emulator visuals, controller behavior and save/reload remain unverified',
      'Extra Hacks Quick Items catalog still recognizes the earlier fixed-L2 routine; refresh it when publishing this BIN'],
    application: {applied: false}
  };
  for (let n=0;n<dra.length;) {
    if(dra[n]===after[n]){n++;continue;}const start=n;while(n<dra.length&&dra[n]!==after[n])n++;
    report.edits.ranges.push({offset:'0x'+start.toString(16).toUpperCase(),before:Buffer.from(dra.subarray(start,n)).toString('hex'),after:Buffer.from(after.subarray(start,n)).toString('hex')});
  }
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2)+'\n');
  await fs.writeFile(path.resolve(directory,'README.md'), '# System settings\n\nThe source BIN is unchanged. System gains Show minimap: Yes/No; Button Config gains Item Shortcut, default L2 on new games. Existing saves retain the previously unused eighth mapping. All eight buttons must be assigned once before exiting Button Config.\n\nUse Left for Yes, Right for No, or Cross to toggle minimap. Save in a save room to retain preferences. Item choices follow configured Right hand (Potion), Left hand (High Potion), Backdash (X-Potion) and Jump (Meal Ticket), preserving every choice when the shortcut moves to a face button.\n\nFresh-boot from a memory-card save to check presentation, every shortcut, normal controls, remapping, and save/reload. Reserve unused equipment icons 316-319 for this helper. Extra Hacks Quick Items catalog needs a signature refresh before release publication.\n\nSee verification.json for both image hashes, patch hashes, source revisions, exact edits and checks. Apply only after explicit user approval.\n');
  console.log(JSON.stringify({sourceSha256:initial,expectedSha256:final,forward:report.forward,reversal:report.reversal,sectors,reportPath},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});

async function auditSlotSpace(disc) {
  const {SLOTS:S}=H, references=[];
  const exe=await disc.readFile(await disc.findPath(['SLUS_000.67']));
  assert.equal(Buffer.from(exe.subarray(0,8)).toString('ascii'),'PS-X EXE');
  const K=require('../../stats-core');
  assert.equal(K.u32(exe,0x18),0x80010000);
  assert.equal(K.u32(exe,0x1C),0x89000);
  assert.ok(K.u32(exe,0x18)+K.u32(exe,0x1C)<=S.code);
  const target=addr=>((addr>>>0)&0x1FFFFFFF)>=0x9C000&&((addr>>>0)&0x1FFFFFFF)<0x9D900;
  let files=0;
  async function walk(dir,prefix='') {
    for(const rec of await disc.readDirectory(dir)) {
      const name=C.normalizeIsoName(rec.name), full=prefix+name;
      if(['.','..','\0','\x01'].includes(name))continue;
      if(rec.isDirectory){await walk(rec,full+'/');continue;}
      if(!(/\.BIN$|SLUS_000\.67$/.test(full))||/F_|ARC_F|MONSTER/.test(full))continue;
      const bytes=await disc.readFile(rec), end=full==='DRA.BIN'?0x962A8:bytes.length;files++;
      for(let at=0;at+4<=end;at+=4){
        const w=K.u32(bytes,at);
        if((w&3)===0&&(w>>>28)===8&&target(w))references.push([full,at,'pointer']);
        if(w>>>26!==15)continue;
        const rt=w>>>16&31, hi=(w&65535)<<16;
        if(![0x80090000|0,0x800A0000|0,0xA0090000|0,0xA00A0000|0].includes(hi))continue;
        for(let p=at+4;p<Math.min(at+40,end);p+=4){
          const v=K.u32(bytes,p), op=v>>>26, rs=v>>>21&31;
          if(rs===rt&&[9,13,32,33,35,36,37,40,41,43].includes(op)&&target((hi+(op===13?v&65535:v<<16>>16))>>>0))references.push([full,at,'address']);
          const written=op===0?v>>>11&31:[1,2,3,4,5,6,7,40,41,43].includes(op)?-1:v>>>16&31;
          if(written===rt)break;
        }
      }
    }
  }
  await walk(disc.root);assert.deepEqual(references,[],'Existing code uses the slot memory reservation.');
  return {files,loadedExecutableEnd:'0x80099000',reservation:'0x8009C000-0x8009D8FF'};
}

async function slotMain() {
  assert.ok(directory,'Supply an output directory.');
  const descriptionOnly=process.argv.includes('--slot-description');
  const itemDescriptions=process.argv.includes('--item-slot-descriptions'), textOnly=descriptionOnly||itemDescriptions;
  const arg=name=>process.argv.find(v=>v.startsWith(name+'='))?.slice(name.length+1).toUpperCase();
  const localSource=process.env.SOTN_ASS_BIN||(require('node:fs').existsSync(source)?source:path.resolve(__dirname,'../../MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin'));
  const original=await fs.readFile(localSource), initial=sha(original), inspected=await inspect(original);
  const itemResult=itemDescriptions?H.prepareSlotItemDescriptions(inspected.dra):null;
  const audit=itemDescriptions?{scope:'Potion, High Potion, X-Potion and Meal Ticket descriptions only',edits:itemResult.edits}:descriptionOnly?{scope:'Shared empty-slot description only',text:H.SLOT_HELP}:await auditSlotSpace(inspected.disc);
  const after=itemDescriptions?itemResult.after:descriptionOnly?H.prepareSlotDescription(inspected.dra).after:require('../../tests/system-settings.test').verifySlots(inspected.dra);
  const changes=await C.changedSectors(inspected.disc,inspected.record,inspected.dra,after), sectors=changes.map(c=>c.start/2352).sort((a,b)=>a-b);
  const image=Buffer.from(original);for(const c of changes)image.set(c.modified,c.start);sectorsValid(image,sectors);
  const final=sha(image), block=original.subarray(0x9320,0x9720);
  const forward=ppf(changes,block,itemDescriptions?'Item descriptions for selectable equipment slots':descriptionOnly?'Equipment slot use description':'Two selectable medicine and food equipment slots');
  const reverse=ppf(changes.map(c=>({...c,original:c.modified,modified:c.original})),block,itemDescriptions?'Reverse slot item descriptions':descriptionOnly?'Reverse equipment slot use description':'Reverse two selectable item equipment slots');
  apply(image,reverse);assert.equal(sha(image),initial);apply(image,forward);assert.equal(sha(image),final);
  apply(image,forward,true);assert.equal(sha(image),initial);apply(image,reverse,true);assert.equal(sha(image),final);
  assert.deepEqual((await inspect(image)).dra,after);
  const touched=new Set(changes.map(c=>c.start));for(let at=0;at<original.length;at+=2352)if(!touched.has(at))assert.deepEqual(image.subarray(at,at+2352),original.subarray(at,at+2352));
  const stem=itemDescriptions?'Equipment-Item-Slot-Descriptions-ASS-2.0.ppf':descriptionOnly?'Equipment-Item-Slots-Description-ASS-2.0.ppf':'Equipment-Item-Slots-ASS-2.0.ppf';
  const forwardPath=path.resolve(directory,stem), reversePath=path.resolve(directory,'Reverse-'+stem);
  const result={source:{path:localSource,size:original.length,sha256:initial},result:{sha256:final},
    forward:{path:forwardPath,size:forward.length,sha256:sha(forward)},reversal:{path:reversePath,size:reverse.length,sha256:sha(reverse)},
    sectors,audit,decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git',revision:revision(decomp)},
    inspected:itemDescriptions?['DRA descriptions and capacities for hand items 159, 160, 161 and 70','installed slot helper','Shift-JIS fullwidth digits','current healing values and item resource costs']:descriptionOnly?['DRA shared empty-slot description','installed slot helper and description entry points','Shift-JIS fullwidth colon, digit 2 and plus']:['DRA menu and item input','native medicine use and food helpers','save flags 0x2FC-0x2FF','sound header padding and executable memory reservation'],
    checks:[textOnly?'Shift-JIS roundtrip and unchanged slot code':'load-delay-aware instruction tests','forward and reversal hashes','both embedded undo paths','source unchanged','unrelated bytes preserved','changed sector checksums'],
    gameplayVerified:false,applied:false};
  assert.equal(sha(await fs.readFile(localSource)),initial,'The source BIN changed during preparation.');
  if(process.argv.includes('--apply')){
    assert.equal(arg('--source-sha'),initial,'Supply the approved source hash.');assert.equal(arg('--result-sha'),final,'Supply the approved result hash.');
    assert.deepEqual(await fs.readFile(forwardPath),forward);assert.deepEqual(await fs.readFile(reversePath),reverse);
    assert.equal(sha(await fs.readFile(localSource)),initial,'The live source changed before writing.');
    const handle=await fs.open(localSource,'r+');try{
      for(const c of changes){const current=Buffer.alloc(2352);assert.equal((await handle.read(current,0,2352,c.start)).bytesRead,2352);assert.deepEqual(current,Buffer.from(c.original));}
      for(const c of changes)assert.equal((await handle.write(c.modified,0,2352,c.start)).bytesWritten,2352);await handle.sync();
    }finally{await handle.close();}
    const live=await fs.readFile(localSource);assert.equal(sha(live),final);sectorsValid(live,sectors);assert.deepEqual((await inspect(live)).dra,after);
    apply(live,reverse);assert.equal(sha(live),initial);result.applied=true;
  }else{
    assert.ok(require('node:fs').existsSync(directory),'Use an existing output directory.');
    for(const [file,data,replaceArg]of [[forwardPath,forward,'--replace-forward-sha'],[reversePath,reverse,'--replace-reverse-sha']]){
      try{const existing=await fs.readFile(file);if(!existing.equals(data))assert.equal(arg(replaceArg),sha(existing),`Existing patch differs: ${file}`);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    await fs.writeFile(forwardPath,forward);await fs.writeFile(reversePath,reverse);
  }
  console.log(JSON.stringify(result,null,2));
}
module.exports.auditSlotSpace=auditSlotSpace;
