const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');
const C = require('../sotn-core.js'), S = require('../disc-stage.js'), EC = require('../entity-catalog.js');
const E = require('../edit-session.js');
const {repair, targets} = require('../tools/map/reverse-caverns-drops.js');
const {machine} = require('./helpers/mips.js');
assert.equal(S.dropRule('RNO4','E_BREAKABLE',0x70B0).slot,176);
assert.equal(S.dropRule('RNO4','E_BREAKABLE',0x801F).slot,31);
assert.equal(S.dropRule('RNO4','E_BREAKABLE',0x60B0).value,176);
assert.equal(S.prizeTableLength({code:'NO3'},7),8);
const initSource = fs.readFileSync(require.resolve('../app.js'),'utf8');
const init = initSource.slice(initSource.indexOf('  function initPrizeDrops('),initSource.indexOf('  function dropGroups('));
function initTable(stage) {
  const sandbox = {window:{SotnStage:S}, EC, dropRule:(code,e,s)=>S.dropRule(code,EC.typeFor(code,e.id).symbol,e.params,s)};
  vm.runInNewContext(init+'\nthis.init=initPrizeDrops;',sandbox); sandbox.init(stage);
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
  const home = process.env.USERPROFILE || process.env.HOME;
  const paths = [
    ['vanilla',process.env.SOTN_VANILLA_BIN || `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`],
    ['modded',process.env.SOTN_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`]
  ];
  for (const [label,path] of paths) {
    if(!fs.existsSync(path)){console.log(`${label} image skipped`);continue;}
    const beforeHash = sha(fs.readFileSync(path));
    const disc = await C.DiscImage.open(await fs.openAsBlob(path));
    const record = await disc.findPath(['ST','RNO4','RNO4.BIN']);
    const stage = S.parseOverlay(await disc.readFile(record)); stage.code='RNO4';
    initTable(stage);
    assert.equal(stage.prizeDrops.values.length,32,'Invalid pots cannot extend the table into other data.');
    const damaged = {...stage,bytes:stage.bytes.slice()};damaged.bytes[0x1660]^=1;
    assert.throws(()=>initTable(damaged),/boundary/);
    if(label==='modded') {
      const pot=stage.entityLayouts.entities[stage.entityLayouts.indices[stage.rooms[6].entityLayoutId]].find(e=>e.id===1&&e.x===32&&e.y===881);
      pot.x++;assert.throws(()=>S.buildOverlay(stage,true),/prize slot/);pot.x--;
      const params=pot.params;pot.params=0x7020;assert.throws(()=>S.buildOverlay(stage,true),/prize slot/);pot.params=params;
      assert.deepEqual(S.buildOverlay(stage,true),stage.bytes,'Existing invalid pots remain unchanged until repaired.');
      assert.throws(()=>repair({...stage,entityLayouts:{...stage.entityLayouts,entities:stage.entityLayouts.entities.map(bank=>bank.map(e=>({...e,params:e.params===0x70B0?0x70B1:e.params})))}}),/pot changed/);
      repair(stage);
      const out = S.buildOverlay(stage,true), reread = S.parseOverlay(out);reread.code='RNO4';initTable(reread);
      const slots = [];
      for(const t of targets) {
        const room = reread.rooms[t.room];
        const bank = reread.entityLayouts.entities[reread.entityLayouts.indices[room.entityLayoutId]];
        const e = bank.find(e=>e.id===1&&e.x===t.x&&e.y===t.y);
        const slot = S.dropRule('RNO4','E_BREAKABLE',e.params).slot;
        assert.equal(slot,t.slot);assert.equal(reread.prizeDrops.values[slot],t.item);slots.push(slot);
        const xBank = reread.banks.get(reread.xPtrs[room.entityLayoutId]);
        const yBank = reread.banks.get(reread.yPtrs[room.entityLayoutId]);
        for(const copies of [xBank.originalEntries,yBank.originalEntries])
          assert.equal(copies.find(e=>e.id===1&&e.x===t.x&&e.y===t.y).params,0x7000|t.slot);
      }
      assert.equal(new Set(slots).size,6,'Each pickup has its own collected flag.');
      let drop = null, destroyed = false;
      const hooks = new Map([
        [0x801CF01C, r => {drop={kind:'prize',params:r[4]};return 'stop';}],
        [0x801CFA30, r => {drop={kind:'equip',params:r[4]};return 'stop';}],
        [0x801CD5FC, () => {destroyed=true;return 'stop';}]
      ]);
      const m = machine([{base:0x80180000,bytes:out}],hooks), entity=0x80110000;
      const mark = slot => {const bit=0x1B8+slot,at=0x8003BEEC+(bit>>>3);m.put(at,1,m.get(at,1)|(1<<(bit&7)));};
      mark(12);mark(23);
      for(const t of targets.slice().reverse()) {
        for(let i=0;i<0x100;i++)m.put(entity+i,1,0);
        m.put(entity+0x30,2,t.slot);drop=null;destroyed=false;
        m.run(0x801D0D98,{4:entity});
        assert.equal(destroyed,false,'Other collected pickups cannot hide these pots.');
        assert.equal(m.get(entity+0xB4,2),0x1B8+t.slot);
        assert.equal(m.get(entity+0x30,2),0x8000+(t.item<128?t.item:t.item-128));
        assert.equal(drop.kind,t.item<128?'prize':'equip');
        m.put(entity+0x2C,2,1);m.put(entity+0x48,1,1);
        m.run(0x801D0D98,{4:entity});
        const bit=0x1B8+t.slot;assert(m.get(0x8003BEEC+(bit>>>3),1)&(1<<(bit&7)));
        m.put(entity+0x2C,2,0);m.put(entity+0x30,2,t.slot);destroyed=false;
        m.run(0x801D0D98,{4:entity});assert.equal(destroyed,true,'Only the collected pot disappears.');
      }
      const saved = E.parse(JSON.stringify(await E.capture({name:'source.bin',stages:new Map([['RNO4',stage]])})));
      const fresh = S.parseOverlay(stage.bytes);fresh.code='RNO4';initTable(fresh);
      const undo = (await E.prepare(saved,{stages:new Map([['RNO4',fresh]])})).apply();
      assert.deepEqual(S.buildOverlay(fresh,true),out);undo();assert.deepEqual(S.buildOverlay(fresh,true),stage.bytes);
      const allowed = new Set(targets.flatMap(t=>[stage.prizeTableOffset+t.slot*2,stage.prizeTableOffset+t.slot*2+1]));
      for(const t of targets) {
        const layout = stage.rooms[t.room].entityLayoutId;
        for(const ptr of [stage.xPtrs[layout],stage.yPtrs[layout]]) {
          const bank=stage.banks.get(ptr),index=bank.originalEntries.findIndex(e=>e.id===1&&e.x===t.x&&e.y===t.y);
          allowed.add(bank.start+index*10+8);allowed.add(bank.start+index*10+9);
        }
      }
      for(let i=0;i<out.length;i++)if(out[i]!==stage.bytes[i])assert(allowed.has(i),`Unexpected change at ${i.toString(16)}`);
    }
    assert.equal(sha(fs.readFileSync(path)),beforeHash);
    console.log(`Reverse Caverns drop checks passed: ${label}`);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
