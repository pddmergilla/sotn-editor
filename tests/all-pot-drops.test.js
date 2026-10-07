const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const C=require('../sotn-core.js'),S=require('../disc-stage.js'),EC=require('../entity-catalog.js'),E=require('../edit-session.js');
const {audit,metadata,probe}=require('../tools/map/audit-pot-drops.js');
const {specs,repair}=require('../tools/map/all-pot-drops.js');
const {machine}=require('./helpers/mips.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const init=source.slice(source.indexOf('  function initPrizeDrops('),source.indexOf('  function dropGroups('));
function initTable(stage){
  const context={window:{SotnStage:S},EC,dropRule:(code,e,s)=>S.dropRule(code,EC.typeFor(code,e.id).symbol,e.params,s)};
  vm.runInNewContext(init+'\nthis.init=initPrizeDrops;',context);context.init(stage);
}
const home=process.env.USERPROFILE||process.env.HOME;
const paths=[['vanilla',process.env.SOTN_VANILLA_BIN||`${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`],
  ['modded',process.env.SOTN_BIN||`${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`]];
(async()=>{
  for(const [label,path]of paths){
    if(!fs.existsSync(path)){console.log(`${label} image skipped`);continue;}
    const beforeHash=sha(fs.readFileSync(path)),disc=await C.DiscImage.open(await fs.openAsBlob(path));
    const checked=await audit(disc);assert.equal(checked.stages.length,58);assert.equal(checked.stages.filter(s=>s.error).length,0);
    assert.equal(checked.pots.filter(p=>p.actual.error||p.actual.kind==='none').length,0);
    assert(checked.issues.every(p=>p.reason==='Outside prize table'),'Every editor rule matches the game.');
    if(label==='vanilla')assert.deepEqual(checked.issues,[]);
    const overlays=new Map();
    for(const [code,length]of [['RNO2',12],['RLIB',18],['RNO4',32],['BO3',38]]){
      const raw=await disc.readFile(await disc.findPath([code==='BO3'?'BOSS':'ST',code,code+'.BIN']));
      let stage=S.parseOverlay(raw);stage.code=code;initTable(stage);
      assert.equal(stage.prizeDrops.values.length,length);
      const damaged={...stage,bytes:stage.bytes.slice()};damaged.bytes[stage.prizeTableOffset+length*2]^=1;
      assert.throws(()=>S.prizeTableLength(damaged,999),/boundary/);
      const meta=metadata(code,code==='BO3'?'BOSS':'ST',raw);
      for(const look of code==='RLIB'?[7,8,9]:[7,8]){
        const actual=probe(raw,meta,(look<<12)|2),rule=S.dropRule(code,'E_BREAKABLE',(look<<12)|2);
        assert.equal(actual.kind,'slot');assert.equal(actual.slot,rule.slot);
      }
      if(label!=='modded'||!specs[code])continue;
      const spec=specs[code];
      const first=spec.targets[0],firstBank=stage.entityLayouts.entities[stage.entityLayouts.indices[stage.rooms[first.room].entityLayoutId]];
      const firstPot=firstBank.find(e=>e.id===1&&e.x===first.x&&e.y===first.y);
      if(firstPot.params===((first.from&0xF000)|first.slot)){
        const original=Uint8Array.from(stage.bytes),view=new DataView(original.buffer);
        for(const t of spec.targets){
          const bank=stage.entityLayouts.entities[stage.entityLayouts.indices[stage.rooms[t.room].entityLayoutId]];
          const pot=bank.find(e=>e.id===1&&e.x===t.x&&e.y===t.y);
          assert.equal(pot.params,(t.from&0xF000)|t.slot);assert.equal(stage.prizeDrops.values[t.slot],t.item);
          view.setUint16(spec.offset+t.slot*2,spec.original?.[t.slot]??t.before,true);
          const layout=stage.rooms[t.room].entityLayoutId;
          for(const ptr of new Set([stage.xPtrs[layout],stage.yPtrs[layout]])){
            const copy=stage.banks.get(ptr),index=copy.originalEntries.findIndex(e=>e.id===1&&e.x===t.x&&e.y===t.y);
            assert.equal(copy.originalEntries[index].params,(t.from&0xF000)|t.slot);
            view.setUint16(copy.start+index*10+8,t.from,true);
          }
        }
        stage=S.parseOverlay(original);stage.code=code;initTable(stage);
      }
      const pot=stage.entityLayouts.entities[stage.entityLayouts.indices[stage.rooms[first.room].entityLayoutId]].find(e=>e.id===1&&e.x===first.x&&e.y===first.y);
      pot.x++;assert.throws(()=>S.buildOverlay(stage,true),/prize slot/);pot.x--;
      const old=pot.params;pot.params=(old&0xF000)|length;assert.throws(()=>S.buildOverlay(stage,true),/prize slot/);pot.params=old;
      assert.deepEqual(S.buildOverlay(stage,true),stage.bytes);
      repair(stage);const out=S.buildOverlay(stage,true),reopened=S.parseOverlay(out);reopened.code=code;initTable(reopened);overlays.set(code,out);
      const allowed=new Set();
      const b=Buffer.from(out),table=meta.table;
      const prize=b.readUInt32LE(table+2*4),equip=b.readUInt32LE(table+9*4),persistent=b.readUInt32LE(table+11*4);
      let drop=null,destroyed=false;
      const hooks=new Map([[prize,r=>{drop={kind:'prize',value:r[4]};return 'stop';}],[equip,r=>{drop={kind:'equip',value:r[4]};return 'stop';}],
        [meta.symbols.DestroyEntity,()=>{destroyed=true;return 'stop';}]]);
      const m=machine([{base:0x80180000,bytes:out}],hooks),entity=0x80110000,base={RNO2:0x178,RLIB:0x1D8,RNO4:0x1B8}[code];
      const mark=slot=>{const bit=base+slot,at=0x8003BEEC+(bit>>>3);m.put(at,1,m.get(at,1)|(1<<(bit&7)));};
      for(const slot of spec.reserved)mark(slot);
      for(const t of spec.targets){
        const rule=probe(out,metadata(code,'ST',out),(t.from&0xF000)|t.slot);assert.equal(rule.slot,t.slot);
        const room=reopened.rooms[t.room];
        for(const ptr of new Set([reopened.xPtrs[room.entityLayoutId],reopened.yPtrs[room.entityLayoutId]])){
          const bank=reopened.banks.get(ptr),index=bank.originalEntries.findIndex(e=>e.id===1&&e.x===t.x&&e.y===t.y);
          assert.equal(bank.originalEntries[index].params,(t.from&0xF000)|t.slot);
          allowed.add(bank.start+index*10+8);allowed.add(bank.start+index*10+9);
        }
        assert.equal(reopened.prizeDrops.values[t.slot],t.item);
        allowed.add(spec.offset+t.slot*2);allowed.add(spec.offset+t.slot*2+1);
        for(let i=0;i<0x100;i++)m.put(entity+i,1,0);m.put(entity+0x30,2,t.slot);drop=null;destroyed=false;
        m.run(persistent,{4:entity});assert.equal(destroyed,false);assert.equal(m.get(entity+0xB4,2),base+t.slot);
        assert.equal(drop.kind,t.item<128?'prize':'equip');assert.equal(m.get(entity+0x30,2),0x8000+(t.item<128?t.item:t.item-128));
        const flags=Array.from({length:64},(_,i)=>m.get(0x8003BEEC+i,1));
        m.put(entity+0x2C,2,1);m.put(entity+0x48,1,1);m.run(persistent,{4:entity});
        const bit=base+t.slot;flags[bit>>>3]|=1<<(bit&7);
        assert.deepEqual(Array.from({length:64},(_,i)=>m.get(0x8003BEEC+i,1)),flags,'Collection marks only this pickup.');
        m.put(entity+0x2C,2,0);m.put(entity+0x30,2,t.slot);destroyed=false;m.run(persistent,{4:entity});assert(destroyed,'Collected pot stays empty.');
      }
      for(let i=0;i<out.length;i++)if(out[i]!==stage.bytes[i])assert(allowed.has(i),`Unrelated byte changed in ${code} at ${i.toString(16)}`);
      const saved=E.parse(JSON.stringify(await E.capture({name:'source.bin',stages:new Map([[code,stage]])})));
      const fresh=S.parseOverlay(stage.bytes);fresh.code=code;initTable(fresh);
      const undo=(await E.prepare(saved,{stages:new Map([[code,fresh]])})).apply();assert.deepEqual(S.buildOverlay(fresh,true),out);
      undo();assert.deepEqual(S.buildOverlay(fresh,true),stage.bytes);
    }
    if(label==='modded'){
      const after=await audit(disc,overlays);assert.deepEqual(after.issues,[]);assert.equal(after.pots.length,checked.pots.length);
      assert.equal(after.pots.length,1398);
    }
    assert.equal(sha(fs.readFileSync(path)),beforeHash);console.log(`All-pot drop checks passed: ${label} (${checked.pots.length} placements)`);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
