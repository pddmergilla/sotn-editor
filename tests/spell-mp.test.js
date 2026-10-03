const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../sotn-core.js');
const K = require('../stats-core.js');
const M = require('../stats-model.js');
const home = process.env.USERPROFILE || process.env.HOME || '';
const sources = [process.env.SOTN_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`,
  process.env.SOTN_VANILLA_BIN || `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`];

function castingCode(dra,table) {
  const hits = M.findTemplate(dra,0x42398,dra.length,[
    'sll v0,a0,3','*','sll v0,v0,2','lui a1,0x8009','addiu a1,a1,0x7BB0',
    'lui at,*','addu at,at,v0','lbu a0,*(at)','lw v1,0(a1)','nop','*',
    'bne v0,zero,*','*','sw v0,0(a1)','j *','ori v0,zero,1','addu v0,zero,zero','*','nop'
  ]);
  assert.equal(hits.length,1,'Recognize the casting check before evaluating it');
  const off = hits[0];
  assert.equal(K.u32(dra,off+4),0x00441023);
  assert.equal(K.u32(dra,off+40),0x0064102A);
  assert.equal(K.u32(dra,off+48),0x00641023);
  assert.equal(K.u32(dra,off+68),0x03E00008);
  const address = (((K.u32(dra,off+20)&0xFFFF)<<16)+(K.u16(dra,off+28)<<16>>16))>>>0;
  assert.equal(address,M.DRA_BASE+table+0x0C,'Casting reads the edited spell table');
  return off;
}

// Run the recognized casting instructions.
function cast(dra,off,id,mp,maxMp) {
  const regs = new Int32Array(32);regs[4]=id;regs[31]=-1;
  const mpAddress = 0x80097BB0, maxAddress=mpAddress+4;
  const memory = new Map([[mpAddress,mp],[maxAddress,maxMp]]);
  let pc=off, delayed=null;
  for(let steps=0;steps<40;steps++) {
    const w=K.u32(dra,pc), op=w>>>26, rs=w>>>21&31, rt=w>>>16&31, rd=w>>>11&31;
    const imm=w<<16>>16, address=(regs[rs]+imm)>>>0;
    let next=null;
    if(op===0) {
      if(w===0) {}
      else if((w&63)===0)regs[rd]=regs[rt]<<(w>>>6&31);
      else if((w&63)===0x21)regs[rd]=regs[rs]+regs[rt];
      else if((w&63)===0x23)regs[rd]=regs[rs]-regs[rt];
      else if((w&63)===0x2A)regs[rd]=Number(regs[rs]<regs[rt]);
      else if((w&63)===8)next=-1;
      else throw Error(`Unsupported casting instruction ${w.toString(16)}`);
    } else if(op===15)regs[rt]=(w&0xFFFF)<<16;
    else if(op===9)regs[rt]=regs[rs]+imm;
    else if(op===13)regs[rt]=regs[rs]|(w&0xFFFF);
    else if(op===36)regs[rt]=dra[address-M.DRA_BASE];
    else if(op===35){assert(memory.has(address));regs[rt]=memory.get(address);}
    else if(op===43){assert(memory.has(address));memory.set(address,regs[rt]);}
    else if(op===5){if(regs[rs]!==regs[rt])next=pc+4+imm*4;}
    else if(op===2)next=(((w&0x3FFFFFF)*4)|0x80000000)>>>0,next-=M.DRA_BASE;
    else throw Error(`Unsupported casting instruction ${w.toString(16)}`);
    regs[0]=0;
    if(delayed===-1)return {ok:!!regs[2],mp:memory.get(mpAddress),maxMp:memory.get(maxAddress)};
    pc=delayed===null?pc+4:delayed;delayed=next;
  }
  throw Error('Casting check did not return');
}
(async()=>{
  let count=0;
  for(const source of [...new Set(sources)]) {
    if(!fs.existsSync(source)){console.log(`Missing image; skipped: ${source}`);continue;}
    const disc=await C.DiscImage.open(await fs.openAsBlob(source));
    const record=await disc.findPath(['DRA.BIN']), dra=await disc.readFile(record);
    const model=M.parse({DRA:{bytes:dra,base:M.DRA_BASE}}), code=castingCode(dra,model.tables.spell);
    for(const spell of model.sections.spells) {
      for(const cost of [0,1,255]) {
        model.set(spell.mp,cost);
        const after=dra.slice();M.apply(model,{DRA:after});
        for(const [mp,expected] of [[0,cost===0],[29,cost<=29],[cost,true],[Math.max(0,cost-1),cost===0]]) {
          assert.deepEqual(cast(after,code,spell.index,mp,Math.max(mp,29)),
            {ok:expected,mp:expected?mp-cost:mp,maxMp:Math.max(mp,29)},`${spell.name}: cost ${cost}, MP ${mp}`);
        }
        if(spell.index===5&&cost===1) {
          const changes=await C.changedSectors(disc,record,dra,after);
          const exported=await C.DiscImage.open(C.modifiedBlob(disc.file,changes));
          const bytes=await exported.readFile(await exported.findPath(['DRA.BIN']));
          assert.equal(bytes[model.field(spell.mp).off],1);
          assert.deepEqual(cast(bytes,code,5,29,29),{ok:true,mp:28,maxMp:29});
          const patch=await C.ppf3Blob(changes,'Spell MP regression').arrayBuffer();
          assert(patch.byteLength>60);
          assert.deepEqual(await disc.readFile(record),dra,'Source image stays intact');
        }
        model.reset(spell.mp);
      }
    }
    console.log(`Spell-cost export and casting instructions passed: ${source}`);count++;
  }
  if(!count)console.log('Spell MP checks skipped; set SOTN_BIN or SOTN_VANILLA_BIN.');
})().catch(error=>{console.error(error);process.exitCode=1;});
