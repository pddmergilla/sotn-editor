const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../sotn-core.js'), H = require('../extra-hacks-ui.js');
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(require.resolve('../extra-hacks-catalog.js'), 'utf8'), context);
const catalog = H.prepareCatalog(context.window.SotnExtraHacks);
const feature = catalog.features.find(f => f.id === 'richter-save');
const name = 'BOSS/BO6/BO6.BIN', base = 0x80180000, ric = 0x800762D8, orb = 0x80077A58;
const signal = 0x801D169C, flags = 0x801D11C4, scene = 0x80181278;
const sources = [process.env.SOTN_VANILLA_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin',
  process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin',
  process.env.SOTN_ASS_OLD_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Symphony of the Night Alter.bin'];

// Follow the actual game instructions.
function run(bytes, start, memory, initial = {}, stops = [], calls = new Map()) {
  const r = new Int32Array(32); r[29] = 0x801FFF00; r[31] = -1;
  for (const [reg, value] of Object.entries(initial)) r[reg] = value;
  const get = (addr, size) => {
    addr >>>= 0;
    let value = 0;
    for (let i = 0; i < size; i++) value |= (memory.has(addr + i) ? memory.get(addr + i) :
      addr + i >= base && addr + i < base + bytes.length ? bytes[addr + i - base] : 0) << (i * 8);
    return value;
  };
  const put = (addr, size, value) => {
    for (let i = 0; i < size; i++) memory.set((addr >>> 0) + i, value >>> (i * 8) & 255);
  };
  let pc = start >>> 0, branch = null, load = null;
  for (let step = 0; step < 2000; step++) {
    if (pc === 0xFFFFFFFF || stops.includes(pc)) return {pc, r, get, put};
    if (calls.has(pc)) {
      if (calls.get(pc)({r, get, put}) === false) return {pc, r, get, put};
      pc = r[31] >>> 0;
      continue;
    }
    const w = get(pc, 4) >>> 0, op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31, rd = w >>> 11 & 31;
    const imm = w << 16 >> 16, addr = (r[rs] + imm) >>> 0;
    let next = null, nextLoad = null;
    if (op === 0) {
      const fn = w & 63, shift = w >>> 6 & 31;
      if (fn === 0) r[rd] = r[rt] << shift;
      else if (fn === 2) r[rd] = r[rt] >>> shift;
      else if (fn === 3) r[rd] = r[rt] >> shift;
      else if (fn === 0x21) r[rd] = r[rs] + r[rt];
      else if (fn === 0x23) r[rd] = r[rs] - r[rt];
      else if (fn === 0x24) r[rd] = r[rs] & r[rt];
      else if (fn === 0x25) r[rd] = r[rs] | r[rt];
      else if (fn === 0x26) r[rd] = r[rs] ^ r[rt];
      else if (fn === 0x27) r[rd] = ~(r[rs] | r[rt]);
      else if (fn === 0x2A) r[rd] = Number(r[rs] < r[rt]);
      else if (fn === 8) next = r[rs] >>> 0;
      else if (fn === 9) { next = r[rs] >>> 0; r[rd] = pc + 8; }
      else throw Error(`Unsupported instruction at ${pc.toString(16)}: ${w.toString(16)}`);
    } else if (op === 15) r[rt] = (w & 65535) << 16;
    else if (op === 9) r[rt] = r[rs] + imm;
    else if (op === 11) r[rt] = Number((r[rs] >>> 0) < (imm >>> 0));
    else if (op === 12) r[rt] = r[rs] & (w & 65535);
    else if (op === 13) r[rt] = r[rs] | (w & 65535);
    else if ([33, 35, 36, 37].includes(op)) {
      const size = op === 35 ? 4 : op === 36 ? 1 : 2;
      const value = get(addr, size);
      nextLoad = [rt, op === 33 ? value << 16 >> 16 : value];
    } else if ([40, 41, 43].includes(op)) put(addr, op === 40 ? 1 : op === 41 ? 2 : 4, r[rt]);
    else if (op === 4) { if (r[rs] === r[rt]) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 5) { if (r[rs] !== r[rt]) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 1 && rt === 1) { if (r[rs] >= 0) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 2 || op === 3) {
      if (op === 3) r[31] = pc + 8;
      next = ((pc & 0xF0000000) | (w & 0x3FFFFFF) << 2) >>> 0;
    } else throw Error(`Unsupported instruction at ${pc.toString(16)}: ${w.toString(16)}`);
    if (load) r[load[0]] = load[1];
    r[0] = 0;
    pc = branch === null ? (pc + 4) >>> 0 : branch;
    branch = next; load = nextLoad;
  }
  throw Error('The checked game path did not finish.');
}

function toggle(bytes, profile, selected) {
  const files = new Map([[name, bytes]]), info = H.featureState(feature, files, profile);
  const analysis = {profile, features: [{id: feature.id, ...info, context: true}]};
  const after = bytes.slice();
  H.applyEdits({before: bytes, after}, H.plan(catalog, analysis, new Map([[feature.id, selected]])), name);
  return after;
}

(async () => {
  let count = 0;
  for (const source of sources) {
    if (!fs.existsSync(source)) { console.log(`Missing image; skipped: ${source}`); continue; }
    const profile = source === sources[0] ? 'vanilla' : 'ass';
    const disc = await C.DiscImage.open(await fs.openAsBlob(source)), record = await disc.findPath(name.split('/'));
    const original = await disc.readFile(record), before = toggle(original, profile, false), after = toggle(before, profile, true);
    assert.equal(H.featureState(feature, new Map([[name, after]]), profile).state, 'on');
    assert.deepEqual(toggle(after, profile, false), before);
    const old = before.slice();
    feature.onVersions[0].forEach((bytes, i) => old.set(bytes, feature.edits[i].offset));
    assert.equal(H.featureState(feature, new Map([[name, old]]), profile).version, 1);
    assert.deepEqual(toggle(old, profile, true), old, 'An unchanged older selection preserves its bytes');
    assert.deepEqual(toggle(old, profile, false), before, 'Remove the earlier sitting-only patch');
    assert.deepEqual(toggle(toggle(old, profile, false), profile, true), after, 'Re-add installs the fix');
    for (const edit of feature.edits) {
      const broken = after.slice(); broken[edit.offset + edit.on.length - 1] ^= 1;
      assert.equal(H.featureState(feature, new Map([[name, broken]]), profile).state, 'unknown');
    }
    for (const edit of feature.edits) {
      const partial = before.slice(); partial.set(edit.on, edit.offset);
      assert.equal(H.featureState(feature, new Map([[name, partial]]), profile).state, 'mixed', 'Reject incomplete installs');
    }
    for (let i = 0; i < before.length; i++) {
      if (!feature.edits.some(e => i >= e.offset && i < e.offset + e.on.length)) assert.equal(after[i], before[i]);
    }
    const change = await C.changedSectors(disc, record, original, after);
    const output = await C.DiscImage.open(C.modifiedBlob(disc.file, change));
    assert.deepEqual(await output.readFile(await output.findPath(name.split('/'))), after);
    for (const sector of change) assert.deepEqual(C.repairSector(sector.modified.slice(), disc.dataOffset), sector.modified);
    assert.deepEqual(await disc.readFile(record), original, 'Keep the source intact');
    const memory = new Map(), access = run(after, 0xFFFFFFFF, memory), {get, put} = access;
    put(ric + 0x2C, 2, 1); put(ric + 0x34, 4, 0x100);
    run(after, base + 0x353AC, memory, {4: ric + 0x2C}, [base + 0x354FC]);
    assert.equal(get(ric + 0x2C, 2), 0x70, 'Lethal damage enters the saved pose');
    const factories = [], calls = new Map([[0x801BBDC0, ({r}) => { factories.push(r[5]); }],
      [0x801ACF6C, ({r, put}) => { assert.equal(r[4] >>> 0, orb); put(orb + 0x26, 2, 0); }]]);
    put(orb + 0x2C, 2, 2); put(orb + 0x34, 4, 0); put(orb + 0x26, 2, 1);
    run(after, base + 0x403E8, memory, {4: orb}, [base + 0x40874], calls);
    assert.equal(get(signal, 4), 1, 'Orb death emits the rescue signal');
    assert.equal(get(orb + 0x2C, 2), 21);
    assert.deepEqual(factories, [0x49, 0x4B], 'Use the normal orb effects and cutscene actors');
    const handoff = new Map([[0x801B5A14, ({r, put}) => { assert.equal(r[4], 0x28); put(0x801CF3C8, 4, 0x28); return false; }]]);
    run(after, base + 0x35A2C, memory, {}, [], handoff);
    assert.equal(get(0x801CF3C8, 4), 0x28, 'The actual installed AI accepts the rescue signal');
    run(after, base + 0x403E8, memory, {4: orb}, [base + 0x40D5C], calls);
    assert.equal(get(signal, 4), 0, 'The rescue signal lasts one update');
    assert.equal(get(orb + 0x26, 2), 0, 'The orb is destroyed');
    assert.deepEqual(factories, [0x49, 0x4B], 'The rescue actors are created once');
    put(scene, 4, 40); put(flags, 4, 0x40);
    run(after, base + 0x36998, memory);
    assert.equal(get(flags, 4), 0x48, 'The native dialogue handoff keeps other cutscene flags');
    for (const [richterDead, orbDead, step, hit] of [[0, 0, 2, 0], [0, 0, 2, 2], [0, 0, 10, 0], [0, 0x100, 2, 0], [0x100, 0, 2, 0]]) {
      const mem = new Map(), a = run(after, 0xFFFFFFFF, mem);
      a.put(ric + 0x34, 4, richterDead); a.put(orb + 0x34, 4, orbDead); a.put(orb + 0x2C, 2, step); a.put(orb + 0x48, 1, hit);
      const result = run(after, base + 0x403E8, mem, {4: orb}, [base + 0x4048C]);
      assert.equal(result.get(signal, 4), richterDead || orbDead ? 1 : 0);
      assert.equal(result.get(orb + 0x2C, 2), richterDead || orbDead ? 20 : hit ? 10 : step);
    }
    // Reproduce the earlier failure.
    const failed = new Map(), f = run(old, 0xFFFFFFFF, failed);
    f.put(ric + 0x34, 4, 0x100); f.put(orb + 0x2C, 2, 2);
    run(old, base + 0x403E8, failed, {4: orb}, [base + 0x4048C]);
    assert.equal(f.get(signal, 4), 0, 'The old jump never starts the rescue');
    console.log(`Richter rescue instructions, upgrade and exported sectors passed: ${source}`); count++;
  }
  assert(count > 0, 'Supply a reference image for the game-code checks');
})().catch(error => { console.error(error); process.exitCode = 1; });

// Check the clock finisher.
(async () => {
 const source=sources[1];if(!fs.existsSync(source))return;
 const disc=await C.DiscImage.open(new Blob([await fs.promises.readFile(source)]));
 const spec=JSON.parse(await fs.promises.readFile(require.resolve('../tools/extra-hacks/specs/richter-ai.json'),'utf8'));
 const before=Buffer.from(await disc.readFile(await disc.findPath(['BOSS','BO6','BO6.BIN']))),after=Buffer.from(before);
 const ai=catalog.features.find(f=>f.id==='richter-ai');
 assert.equal(H.featureState(ai,new Map([[name,before]]),'ass').state,'on');
 for(const edit of ai.edits)after.set(edit.on,edit.offset);
 assert.equal(H.featureState(ai,new Map([[name,after]]),'ass').state,'on');
 const incomplete=Buffer.from(after);incomplete.fill(0,0x4e800,0x4e810);
 assert.notEqual(H.featureState(ai,new Map([[name,incomplete]]),'ass').state,'on');
 for(const at of [0x47408,0x4f0a0,0x17e9]){const broken=Buffer.from(after);broken[at]^=1;assert.notEqual(H.featureState(ai,new Map([[name,broken]]),'ass').state,'on',`Stopwatch crash byte ${at.toString(16)}`);}
 const withoutImmunity=Buffer.from(after);withoutImmunity.set(Buffer.from('0780013c0c6323ac','hex'),0x34bf0);
 assert.notEqual(H.featureState(ai,new Map([[name,withoutImmunity]]),'ass').state,'on');
 for(const forms of ai.onVersions){const older=Buffer.from(after);forms.forEach((form,i)=>older.set(form,ai.edits[i].offset));older[0x268f2]=7;assert.equal(H.featureState(ai,new Map([[name,older]]),'ass').state,'on');}
 const tuned=Buffer.from(before);tuned[0x268f2]=7;
 assert.equal(H.featureState(ai,new Map([[name,tuned]]),'ass').state,'on');

 const focused={...catalog,features:[ai]};
 function inspect(bytes){return {profile:'ass',features:[{id:ai.id,...H.featureState(ai,new Map([[name,bytes]]),'ass'),context:true}]};}
 assert.equal(H.plan(focused,inspect(tuned),new Map([[ai.id,true]])).length,0);
 const removed=Buffer.from(before);
 H.applyEdits({before,after:removed},H.plan(focused,inspect(before),new Map([[ai.id,false]])),name);
 assert.equal(H.featureState(ai,new Map([[name,removed]]),'ass').state,'off');
 const upgraded=Buffer.from(removed);
 H.applyEdits({before:removed,after:upgraded},H.plan(focused,inspect(removed),new Map([[ai.id,true]])),name);
 assert.deepEqual(upgraded,after);
 const restored=Buffer.from(upgraded);
 H.applyEdits({before:upgraded,after:restored},H.plan(focused,inspect(upgraded),new Map([[ai.id,false]])),name);
 assert.deepEqual(restored,removed);
 assert.equal(removed.subarray(0x39aa4,0x39aac).toString('hex'),'0780053cb8c3a58c');
 const owned=new Set();for(const e of ai.edits)for(let i=0;i<e.on.length;i++)owned.add(e.offset+i);
 for(let i=0;i<before.length;i++)if(!owned.has(i))assert.equal(upgraded[i],before[i]);

 const symbols=Object.fromEntries(Object.entries(spec.finisher.entryPoints).map(([k,v])=>[k,Number(v)]));
 symbols.Clock=symbols.Stopwatch;

const vm=require('node:vm'),fss=require('node:fs'),path=require('node:path');
const helperPath=path.join(__dirname,'helpers/mips.js'),ctx={module:{exports:{}},require:require('node:module').createRequire(helperPath)};
const helper=fss.readFileSync(helperPath,'utf8').replace("f === 0x18) { const v = BigInt(r[rs]) * BigInt(r[rt]);", "f === 0x18 || f === 0x19) { const v = BigInt(f === 0x19 ? r[rs] >>> 0 : r[rs]) * BigInt(f === 0x19 ? r[rt] >>> 0 : r[rt]);");
vm.runInNewContext(helper.replace("else if (f === 0x26)", "else if (f === 0x27) set(rd, ~(r[rs] | r[rt])); else if (f === 0x26)"),ctx);const {machine}=ctx.module.exports;
const dra=Buffer.from(await disc.readFile(await disc.findPath(['DRA.BIN'])));
const P=0x800733d8,R=P+64*188,F=0x801cf3a0,AI=0x801b6980,G=0x80072f80,HP=0x80097ba0,M=0x52494346;
let nativeCalls=0,kills=0,crashes=[],numbers=[],sounds=[],failFactory=false;
const hooks=new Map([
 [0x801ce7c8,(r,m)=>{nativeCalls++;if(!m.get(AI+0x13,1)){m.put(AI+0x13,1,1);m.put(AI+0x15,1,1);m.put(AI+0x16,1,1);}}],
 [0x801bbdc0,(r,m)=>{if(failFactory){r[2]=0;return;}const i=Array.from({length:12},(_,i)=>68+i).find(i=>!m.get(P+i*188+0x26,2));assert(i!==undefined);const e=P+i*188;m.put(e+0x26,2,1);m.put(e+0x30,2,r[5]&0xfff);m.put(e+0xa0,2,(r[5]&0xff0000)>>8);m.put(e+0x8c,4,r[4]);r[2]=e;crashes.push(r[5]>>>0);}],
 [0x801acf6c,(r,m)=>{const e=r[4]>>>0;for(let i=0;i<188;i++)m.put(e+i,1,0);}],
 [0x801cb664,(r,m)=>{m.put(r[4]+0x2c,2,3);m.put(0x800973fc,4,1);}],
 [0x801c5dc4,(r,m)=>{if(!m.get(r[4]+0x2c,2))m.put(r[4]+0x2c,2,1);}],
 [0x800fe8f0,()=>{}],
 [0x80118c84,r=>numbers.push(r[4])],
 [0x80115394,(r,m)=>{assert.equal(m.get(0x8006c3b8,4)>>>0,P);assert.equal(m.get(r[4]+4,4),2);kills++;m.put(0x80072f2c,4,0x40000);}],
 [0x8000abcd,r=>sounds.push(r[4])],
 [0x801b9c14,()=>{}]
]);
const m=machine([{base:0x80180000,bytes:after},{base:0x800a0000,bytes:dra}],hooks);
function reset(){
 for(let i=0;i<256*188;i++)m.put(P+i,1,0);
 for(const [a,n] of [[F,20],[AI,24],[0x80072ef4,0x92],[0x801d15e8,0xc0]])for(let i=0;i<n;i++)m.put(a+i,1,0);
 m.put(0x8006c3b8,4,R);m.put(R+0x26,2,0x40);m.put(R+0x2c,2,1);m.put(P+0x2c,2,0);m.put(P+0x54,2,2);
 m.put(0x801d1618,4,1);m.put(0x80072f20,4,1);m.put(HP,4,100);m.put(0x8003c7dc,4,0x8000abcd);m.put(0x8003c7b8,4,0x8000abcd);
 m.put(R,4,160<<16);m.put(P,4,80<<16);m.put(R+4,4,179<<16);m.put(P+4,4,179<<16);
 m.put(P+0x46,1,8);m.put(P+0x47,1,16);
 m.put(R+0x46,1,8);m.put(R+0x47,1,16);
 nativeCalls=kills=0;crashes=[];numbers=[];sounds=[];failFactory=false;
}
function tick(){m.put(0x8006c3b8,4,R);m.run(0x801b5a2c);}
function stance(){
 assert.equal(m.get(R+0x2c,2),1);assert.equal(m.get(R+0x2e,2),1);assert.equal(m.get(R+0x4c,4)>>>0,0x80181f1c);
 assert.equal(sounds.filter(s=>s===0x82b).length,1);const n=crashes.filter(p=>(p&0xfff)===44).length;
 for(let i=0;i<59;i++){tick();assert.equal(m.get(F+8,4),4);assert.equal(m.get(0x801d15ec,4),0x1000);assert.equal(crashes.filter(p=>(p&0xfff)===44).length,n);assert.equal(m.get(R+8,4),0);}
 tick();assert.equal(m.get(F+8,4),3);assert.equal(crashes.filter(p=>(p&0xfff)===44).length,n+1);assert.equal(sounds.filter(s=>s===0x82b).length,1);
}
function grabbed(){
 m.put(0x8006c3b8,4,P);hooks.set(0x8010b360,()=> 'stop');
 m.run(0x8010ada4,{3:0x80070000});assert.equal(m.get(P+0x2c,2),12);
 m.run(0x80116208);m.put(0x8006c3b8,4,R);
}
reset();tick();assert.equal(m.get(G,2),1);assert.equal(m.get(F,4),1);assert.equal(m.get(R+0x2c,2),0x1c);assert(crashes.includes(65));assert.equal(m.get(0x801814f3,1),0x41);
grabbed();assert.equal(m.get(G,2),2);assert.equal(m.get(P+0x2e,2),1);
tick();assert.equal(m.get(P+0x2e,2),2);assert.equal(m.get(R+0x2c,2),0x1c);
m.run(0x801b9d2c,{4:0});m.put(R,4,208<<16);tick();assert.equal(m.get(F+8,4),2);tick();assert.equal(m.get(0x801d15ec,4),0x8000);
m.run(0x801b9aa4,{4:0x14000});assert.equal(m.get(R+8,4),-0xe000);
m.put(R,4,160<<16);tick();assert.equal(m.get(F+8,4),4);stance();assert.equal(m.get(R+0x2c,2),0x16);assert.equal(m.get(R,4),160<<16);assert.equal(m.get(R+0x14,2),1);
const knife=P+100*188; m.put(knife+0x26,2,0x26);m.put(knife+0x30,2,0x100);m.put(knife,4,80<<16);m.put(knife+4,4,179<<16);m.put(knife+0x46,1,4);m.put(knife+0x47,1,2);
m.run(symbols.Knife,{4:knife});assert.equal(m.get(HP,4),90);assert.equal(numbers.at(-1),10);assert.equal(m.get(G,2),2);m.run(symbols.Knife,{4:knife});assert.equal(m.get(HP,4),90);
m.put(F+4,4,300);tick();assert.equal(m.get(G,2),0);assert.equal(m.get(P+0x2c,2),0);assert.equal(m.get(0x80072efc,2),0);assert.equal(m.get(0x800973fc,4),0);assert.equal(m.get(F,4),0);for(let i=68;i<80;i++)assert.notEqual(m.get(P+i*188+0xb4,4)>>>0,M);
// Wait for landing before the clock starts.
for(const vy of [-0x30000,0x30000]) {
 reset();m.put(0x80072f20,4,0);m.put(P+0x2c,2,3);m.put(P+0xc,4,vy);m.put(P+8,4,0x10000);
 for(let i=0;i<420;i++){tick();assert.equal(m.get(G,2),0);assert.equal(m.get(F+4,4),0);assert.equal(m.get(F+8,4),0);assert.equal(m.get(0x80072efc,2),0);assert.equal(m.get(P+0xc,4),vy);assert.equal(m.get(P+8,4),0x10000);}
 assert.equal(crashes.length,0);assert.equal(nativeCalls,1);assert.equal(m.get(AI+0x13,1),1);
 m.put(0x80072f20,4,1);tick();assert.equal(m.get(G,2),0);
 m.put(P+0xc,4,0);tick();assert.equal(m.get(G,2),1);assert.equal(m.get(F+4,4),1);assert.equal(crashes.filter(p=>(p&0xfff)===65).length,1);
 grabbed();tick();assert.equal(m.get(P+0xc,4),0);m.put(F+4,4,300);tick();assert.equal(m.get(P+0x2c,2),0);assert.equal(m.get(0x80072efc,2),0);
}
reset();m.put(0x801d1618,4,0);for(let i=0;i<90;i++)tick();assert.equal(m.get(G,2),0);assert.equal(m.get(F+4,4),0);m.put(0x801d1618,4,1);tick();assert.equal(m.get(G,2),1);
// Stay on the same side with a gap.
for(const face of [0,1])for(const side of [0,1]){
 reset();tick();grabbed();m.put(F+8,4,2);m.put(P,4,128<<16);m.put(P+0x14,2,face);m.put(R,4,(side?240:16)<<16);m.put(R+0x2c,2,2);tick();assert.equal(m.get(F+8,4),2);assert.equal(m.get(R+8,4),side?-0xe000:0xe000);
 const target=(side?208:48)<<16;m.put(R,4,target+(side?0x8000:-0x8000));tick();assert.equal(m.get(F+8,4),4);assert.equal(m.get(R,4),target);assert.equal(m.get(R+8,4),0);assert.equal(m.get(R+0x14,2),side);
 assert.equal(Math.abs((m.get(R,4)-m.get(P,4))>>16)-m.get(R+0x46,1)-m.get(P+0x46,1),64);stance();
}
for(const side of [0,1]){
 reset();tick();grabbed();m.put(F+8,4,2);m.put(P,4,(side?200:50)<<16);m.put(P+0x14,2,side?1:0);m.put(R,4,(side?248:8)<<16);m.put(R+0x2c,2,2);tick();assert.equal(m.get(F+8,4),4);assert.equal(m.get(R,4),(side?248:8)<<16);stance();
}
reset();failFactory=true;tick();assert.equal(m.get(G,2),0);assert.equal(m.get(F+8,4),0);failFactory=false;tick();assert.equal(m.get(G,2),1);
reset();m.put(G,2,2);tick();assert.equal(m.get(F,4),0);assert.equal(m.get(G,2),2);assert.equal(m.get(AI+0x13,1),0);
reset();tick();grabbed();m.put(R+0x34,4,0x100);tick();assert.equal(m.get(G,2),0);assert.equal(m.get(F,4),0);
reset();tick();grabbed();m.put(F+8,4,3);m.put(HP,4,10);m.put(knife+0x26,2,0x26);m.put(knife+0x30,2,0x100);m.put(knife,4,80<<16);m.put(knife+4,4,179<<16);m.put(knife+0x46,1,4);m.put(knife+0x47,1,2);m.run(symbols.Knife,{4:knife});assert.equal(m.get(HP,4),0);assert.equal(kills,1);assert.equal(m.get(G,2),0);assert.equal(m.get(F,4),0);

reset();m.put(AI+0x13,1,1);m.run(0x801b9aa4,{4:0x14000});assert.equal(m.get(R+8,4),0x14000);
m.put(knife+0x26,2,0x26);m.put(knife+0x30,2,0);m.put(knife+0x3c,2,3);m.put(knife,4,80<<16);m.put(knife+4,4,179<<16);m.put(knife+0x46,1,4);m.put(knife+0x47,1,2);
m.run(symbols.Knife,{4:knife});assert.equal(m.get(HP,4),100);assert.equal(m.get(knife+0x3c,2),3);
const clock=P+101*188;
for(const form of [5,7,14,24,25,34]){
 reset();m.put(P+0x2c,2,form);m.put(P+0x54,2,13);m.put(P+0x18,1,0x70);m.put(0x80072f1a,2,100);m.put(0x80072f1c,2,100);tick();grabbed();assert.equal(m.get(P+0x54,2),1);assert.equal(m.get(P+0x18,1),0);assert.equal(m.get(G,2),2);tick();assert.equal(m.get(P+0x2e,2),2);assert.equal(m.get(P+0xac,1),0x37);
}

hooks.set(0x80016c9c,r=>{r[2]=Math.round(Math.sin((r[4]&4095)*Math.PI/2048)*4096);});
hooks.set(0x80016d68,r=>{r[2]=Math.round(Math.cos((r[4]&4095)*Math.PI/2048)*4096);});
hooks.set(0x800160e4,r=>{r[2]=Math.floor(Math.sqrt(r[4]>>>0));});
hooks.delete(0x801c5dc4);hooks.delete(0x801cb664);
hooks.set(0x8000abce,(r,q)=>{const start=r[5]===9?3:0,count=r[5];r[2]=start;for(let i=start;i<start+count;i++){q.put(0x80086fec+i*52,4,i<start+count-1?0x80086fec+(i+1)*52:0);q.put(0x80086fec+i*52+7,1,4);}});
hooks.set(0x8000abcf,(r,q)=>{for(let i=0;i<16;i++)q.put(r[6]+i,1,0);});
reset();tick();grabbed();m.put(F+8,4,3);m.put(R+0x14,2,0);m.put(knife+0x26,2,0x26);m.put(knife+0x30,2,0x100);m.put(knife,4,60<<16);m.put(knife+4,4,179<<16);m.put(0x8003c7b8,4,0x8000abce);m.put(0x8003c7bc,4,0x8000abcf);m.put(0x8006c3b8,4,knife);
m.run(symbols.Knife,{4:knife});assert.equal(m.get(knife+8,4),0x80000);assert.equal(m.get(HP,4),100);m.run(symbols.Knife,{4:knife});assert.equal(m.get(HP,4),90);assert.equal(m.get(knife+0x3c,2),0);
// The real crash clock draws only its own three pieces; the other clocks are their own entities.
hooks.delete(0x801acf6c);m.put(0x8003c7b4,4,0x800ede78);
function quartet(){
 let p=0x80086fec,seen=[];
 while(p){assert(!seen.includes(p));seen.push(p);assert(seen.length<=3);p=m.get(p,4)>>>0;}
 assert.equal(seen.length,3);
}
reset();tick();grabbed();m.put(clock+0x30,2,0x100);m.put(clock+0x26,2,0x37);m.put(clock,4,160<<16);m.put(clock+4,4,179<<16);m.put(0x8003c7b8,4,0x8000abce);
// Release follows the watch's own ending.
let opening=0;
while(m.get(clock+0x2c,2)!==3 && opening++<100){m.put(0x8006c3b8,4,clock);m.run(symbols.Clock,{4:clock});tick();assert(m.get(G,2)>0);}
assert.equal(m.get(clock+0x7c,2),5);assert.equal(opening,30);quartet();
m.run(0x801b9d2c,{4:0});
const beforeRain=crashes.length;
for(let i=1;i<=300;i++){
 m.put(0x8006c3b8,4,clock);m.run(symbols.Clock,{4:clock});tick();assert(m.get(G,2)>0);
 assert.equal(m.get(clock+0x2c,2),i===300?4:3);
 if(i<300)assert.equal(m.get(clock+0x7c,2),5-Math.floor(i/60));quartet();
 assert.equal(crashes.slice(beforeRain).filter(p=>(p&0xfff)===12).length,0);
}
let ending=0;
while(m.get(clock+0x26,2) && ending++<40){m.put(0x8006c3b8,4,clock);m.run(symbols.Clock,{4:clock});if(m.get(clock+0x26,2)){tick();assert(m.get(G,2)>0);}}
// The crash clock skips the shrink: it strikes lightning, then ends.
assert.equal(ending,2);assert.equal(crashes.filter(p=>p===0x36).length,1);for(let i=0;i<12;i++)assert.equal(m.get(0x80086fec+i*52+7,1),0);assert.equal(m.get(G,2),0);assert.equal(m.get(0x800973fc,4),0);assert.equal(m.get(F+8,4),5);
const rainStart=crashes.length;failFactory=true;tick();assert.equal(m.get(G,2),0);assert.equal(m.get(F+8,4),5);failFactory=false;tick();assert.equal(m.get(F,4),0);assert.equal(m.get(R+0x2c,2),0x15);assert.equal(crashes.slice(rainStart).filter(p=>(p&0xfff)===12).length,1);
const rainCalls=crashes.length;tick();assert.equal(crashes.length,rainCalls);assert.equal(m.get(G,2),0);
console.log('Clock opening/countdown/ending frames',opening,300,ending,'Hydrostorm factories',crashes.slice(rainStart));
assert(crashes.includes(66));

// A defeated Richter drops the held clock and Alucard.
for(const face of [0,1]){
 reset();tick();grabbed();m.put(R+0x14,2,face);m.put(clock+0x14,2,face);m.put(clock+0x30,2,0x100);m.put(clock+0x26,2,0x37);m.put(clock,4,160<<16);m.put(clock+4,4,179<<16);m.put(0x8003c7b8,4,0x8000abce);
 for(let i=0;i<40;i++){m.put(0x8006c3b8,4,clock);m.run(symbols.Clock,{4:clock});quartet();}
 m.put(R+0x34,4,0x100);tick();assert.equal(m.get(G,2),0);
 for(let i=0;i<12;i++)assert.equal(m.get(0x80086fec+i*52+7,1),0);
}
// An ordinary watch keeps three pieces.
reset();m.put(clock+0x26,2,0x37);m.put(0x8003c7b8,4,0x8000abce);m.put(0x8006c3b8,4,clock);m.run(symbols.Clock,{4:clock});assert.equal(m.get(clock+0xa8,4),0);assert.equal(m.get(0x80086fec+2*52,4),0);assert(crashes.includes(64));
// The crash entity creates four clocks 17 frames apart, like player Richter.
reset();tick();grabbed();const control=P+103*188;m.put(control+0x26,2,0x39);
const spawned=[];for(let frame=0;frame<60&&m.get(control+0x26,2);frame++){const n=crashes.length;m.run(symbols.CrashStopwatch,{4:control});if(crashes.length>n)spawned.push([frame,crashes.at(-1)]);}
assert.deepEqual(spawned,[[0,0x1003f],[17,0x2003f],[34,0x3003f],[51,0x4003f]]);assert.equal(m.get(control+0x26,2),0);
assert(Array.from({length:12},(_,i)=>P+(68+i)*188).some(e=>m.get(e+0x30,2)===63&&m.get(e+0xb4,4)>>>0===M));
m.put(F+4,4,300);tick();for(let i=68;i<80;i++)assert.equal(m.get(P+i*188+0xb4,4)>>>0===M,false,`Queued clock ${i}`);
for(const params of [0,1]){
 reset();tick();const effect=P+104*188;let allocated=0;hooks.set(0x8000abce,(r,q)=>{allocated=r[5];r[2]=0;for(let i=0;i<16;i++)q.put(0x80086fec+i*52,4,i<15?0x80086fec+(i+1)*52:0);});
 m.put(effect+0x26,2,0x3a);m.put(effect+0x30,2,params);m.put(effect,4,160<<16);m.put(effect+4,4,179<<16);m.put(0x8003c7b8,4,0x8000abce);
 for(let i=0;i<28;i++)if(m.get(effect+0x26,2)){m.put(0x8006c3b8,4,effect);m.run(0x801c9de8,{4:effect});assert.equal(m.get(effect+0x3c,2),0);}
 assert.equal(allocated,16);assert.equal(m.get(effect+0x26,2),0);assert.equal(m.get(0x801d1666,2),1);
}
reset();tick();grabbed();m.put(clock+0x26,2,0x37);m.put(0x8003c7b8,4,0x8000abce);hooks.set(0x8000abce,r=>{r[2]=-1;});m.put(0x8006c3b8,4,clock);m.run(symbols.Clock,{4:clock});assert.equal(m.get(G,2),0);assert.equal(m.get(F,4),0);
// Stopwatch never slows Richter's updates.
reset();hooks.set(0x801b4bf8,()=> 'stop');m.run(0x801b4bd0);hooks.delete(0x801b4bf8);
const immuneFlags=m.get(R+0x34,4)>>>0;assert.equal(immuneFlags,0x18402200);
let richterUpdates=0,otherUpdates=0;hooks.set(0x8000abdd,()=>{richterUpdates++;});hooks.set(0x8000abde,()=>{otherUpdates++;});
m.put(R+0x28,4,0x8000abdd);const other=P+180*188;m.put(other+0x28,4,0x8000abde);m.put(other+0x2c,2,1);m.put(other+0x34,4,0x200);
for(const stopped of [0,1]){
 richterUpdates=otherUpdates=0;m.put(0x800973fc,4,stopped);
 for(let frame=0;frame<8;frame++){m.put(0x8003c8c4,4,frame);m.run(0x801a9b84);assert.equal(m.get(0x800973fc,4),stopped);}
 assert.equal(richterUpdates,8);assert.equal(otherUpdates,stopped?2:8);
}
m.put(R+0x34,4,immuneFlags&~0x2000);richterUpdates=0;for(let frame=0;frame<8;frame++){m.put(0x8003c8c4,4,frame);m.run(0x801a9b84);}assert.equal(richterUpdates,2);
console.log('Finisher instructions: grounded wait, Stopwatch immunity, same-side spacing, room edges, grab, slow walk, exact damage, watch ending, Hydrostorm, queued-shot cleanup, allocation failure and death checks passed.');

})().catch(error => {console.error(error);process.exitCode=1;});
