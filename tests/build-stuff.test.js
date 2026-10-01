const assert=require("node:assert/strict");
const S=require("../build-stuff.js");

const BASE=0x800A0000;
const word=(b,o)=>(b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0;
const put=(b,o,v)=>{b[o]=v&255;b[o+1]=v>>>8&255;b[o+2]=v>>>16&255;b[o+3]=v>>>24&255;};
const dra=new Uint8Array(0x80000);
for(const [at,value] of [[0x61D38,0x3C028004],[0x61D3C,0x8C42C8C4],[0x61D40,0],[0x61D44,0x3042003F],
  [0x6F200,0x00438821],[0x6F214,0x3266FFFF],[0x6F218,0x10C00055]])put(dra,at,value);
assert.throws(()=>S.patchDra(dra),/Unsupported debug viewer/);
for(const code of [S.heartCode(),S.weaponCode()])dra.set(code.bytes,code.start);
assert.equal(S.heartCode().start,0x42B08);
assert.equal(S.weaponCode().start,0x42BA0);

const overlay=new Uint8Array(0x800);
for(const at of [0x100,0x630]){
  put(overlay,at,0x34020008);put(overlay,at+4,0x3C018007);put(overlay,at+8,0xA4222F78);
}
assert.equal(S.patchHeals(overlay,"NO0","ST"),true);
assert.equal(word(overlay,0x100),0x34020014);
assert.equal(word(overlay,0x630),0x34020028);
assert.throws(()=>S.patchHeals(overlay,"NO0","ST"),/Unsupported healing/);
assert.throws(()=>S.validateAreas("ST",[{name:"EXTRA"}]),/Unexpected ST\/EXTRA/);

function simulate(start,regs,memory){
  const r=new Uint32Array(32);Object.assign(r,regs);
  let pc=start,hi=0;
  const signed=x=>x|0;
  const load=addr=>memory.get(addr>>>0)??(addr>=BASE&&addr-BASE+4<=dra.length?word(dra,addr-BASE):0);
  const store=(addr,value)=>memory.set(addr>>>0,value>>>0);
  function step(at,delay=false){
    const w=load(at),op=w>>>26,rs=w>>>21&31,rt=w>>>16&31,rd=w>>>11&31,fn=w&63,imm=(w<<16)>>16;
    let next=(at+4)>>>0,jump=null;
    if(op===0){
      if(fn===0x2A)r[rd]=signed(r[rs])<signed(r[rt])?1:0;
      else if(fn===0x21)r[rd]=(r[rs]+r[rt])>>>0;
      else if(fn===0x1B)hi=r[rs]%r[rt];
      else if(fn===0x10)r[rd]=hi;
      else if(fn===8)jump=r[rs];
      else if(w!==0)throw new Error(`Unknown register instruction 0x${w.toString(16)}.`);
    }else if(op===9)r[rt]=(r[rs]+imm)>>>0;
    else if(op===10)r[rt]=signed(r[rs])<imm?1:0;
    else if(op===15)r[rt]=(w&0xffff)<<16;
    else if(op===35)r[rt]=load((r[rs]+imm)>>>0);
    else if(op===37){const addr=(r[rs]+imm)>>>0;r[rt]=dra[addr-BASE]|dra[addr-BASE+1]<<8;}
    else if(op===43)store((r[rs]+imm)>>>0,r[rt]);
    else if(op===4||op===5){if((op===4)===(r[rs]===r[rt]))jump=(at+4+imm*4)>>>0;}
    else if(op===2)jump=((at+4)&0xF0000000)|((w&0x3FFFFFF)<<2);
    else throw new Error(`Unknown opcode ${op}.`);
    r[0]=0;
    if(jump!==null&&!delay){step(next,true);next=jump>>>0;}
    return next;
  }
  for(let count=0;count<200;count++){
    if(pc===0xDEADBEEF||pc===BASE+0x6F370||pc===BASE+0x6FAC4)return {pc,regs:r};
    pc=step(pc);
  }
  throw new Error("Patch did not return.");
}

const heartMemory=new Map([[0x80097BA8,10],[0x80097BAC,13]]);
for(let i=1;i<=60;i++){
  heartMemory.set(0x8003C8C4,i);
  const out=simulate(BASE+0x42B08,{29:0x801FFF00,31:0xDEADBEEF},heartMemory);
  assert.equal(out.regs[2],i);
}
assert.equal(heartMemory.get(0x80097BA8),12);
for(let i=61;i<=120;i++){
  heartMemory.set(0x8003C8C4,i);
  simulate(BASE+0x42B08,{29:0x801FFF00,31:0xDEADBEEF},heartMemory);
}
assert.equal(heartMemory.get(0x80097BA8),13);

dra[0x4B28]=10;dra[0x4B29]=0;
const weaponRegs={6:1,17:BASE+0x4B04,31:0xDEADBEEF};
assert.equal(simulate(BASE+0x42BA0,weaponRegs,new Map([[0x80097BB0,10]])).pc,0xDEADBEEF);
const blocked=simulate(BASE+0x42BA0,weaponRegs,new Map([[0x80097BB0,9]]));
assert.equal(blocked.pc,BASE+0x6FAC4);assert.equal(blocked.regs[2],0);
assert.equal(simulate(BASE+0x42BA0,{...weaponRegs,6:0},new Map([[0x80097BB0,0]])).pc,BASE+0x6F370);
console.log("Gameplay build patch tests passed.");
