(function(global){
  "use strict";
  const CORE=global.SotnCore||(typeof require==="function"?require("./sotn-core.js"):null);
  const DRA_BASE=0x800A0000;
  const HEART_HOOK=0x61D3C,WEAPON_HOOK=0x6F214;
  const DEBUG_VIEWER=0x42B00,HEART_CAVE=0x42B08,WEAPON_CAVE=0x42BA0,CAVE_END=0x42C00;
  const DEBUG_VIEWER_HASH=0x770577C4;
  const NO_HEAL=new Set(["MAD","SEL","TE1","TE2","TE3","TE4","TE5"]);
  const EXPECTED={
    ST:new Set("ARE CAT CEN CHI DAI DRE LIB MAD NO0 NO1 NO2 NO3 NO4 NP3 NZ0 NZ1 RARE RCAT RCEN RCHI RDAI RLIB RNO0 RNO1 RNO2 RNO3 RNO4 RNZ0 RNZ1 RTOP RWRP SEL ST0 TE1 TE2 TE3 TE4 TE5 TOP WRP".split(" ")),
    BOSS:new Set("BO0 BO1 BO2 BO3 BO4 BO5 BO6 BO7 MAR RBO0 RBO1 RBO2 RBO3 RBO4 RBO5 RBO6 RBO7 RBO8".split(" "))
  };
  const u32=(b,o)=>(b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0;
  const put32=(b,o,v)=>{b[o]=v&255;b[o+1]=v>>>8&255;b[o+2]=v>>>16&255;b[o+3]=v>>>24&255;};
  const I=(op,rs,rt,imm)=>((op<<26)|(rs<<21)|(rt<<16)|(imm&0xffff))>>>0;
  const R=(rs,rt,rd,fn)=>((rs<<21)|(rt<<16)|(rd<<11)|fn)>>>0;
  const J=(op,addr)=>((op<<26)|((addr>>>2)&0x3ffffff))>>>0;
  function hashBlock(bytes,start,end){
    let hash=0x811C9DC5;
    for(let at=start;at<end;at++)hash=Math.imul(hash^bytes[at],0x01000193)>>>0;
    return hash;
  }

  function assembler(start){
    const words=[],labels=new Map(),fixups=[];
    return {
      emit(word){words.push(word>>>0);},
      label(name){labels.set(name,words.length);},
      branch(op,rs,rt,name){fixups.push({at:words.length,op,rs,rt,name});words.push(0);},
      finish(){
        for(const f of fixups){
          const target=labels.get(f.name);
          if(target===undefined)throw new Error(`Missing patch label ${f.name}.`);
          const distance=target-f.at-1;
          if(distance<-32768||distance>32767)throw new Error("Patch branch is too far.");
          words[f.at]=I(f.op,f.rs,f.rt,distance);
        }
        const out=new Uint8Array(words.length*4);
        words.forEach((word,n)=>put32(out,n*4,word));
        return {start,bytes:out};
      }
    };
  }

  function heartCode(){
    const a=assembler(HEART_CAVE);
    a.emit(I(9,29,29,-16));
    a.emit(I(43,29,3,0));a.emit(I(43,29,8,4));a.emit(I(43,29,9,8));
    a.emit(I(15,0,8,0x8004));a.emit(I(35,8,9,0xc8c4));a.emit(I(9,0,3,60));
    a.emit(R(9,3,0,0x1B));a.emit(0);a.emit(R(0,0,3,0x10));
    a.branch(5,3,0,"done");a.emit(0);
    a.emit(I(15,0,8,0x8009));a.emit(I(35,8,9,0x7ba8));a.emit(I(35,8,3,0x7bac));a.emit(0);
    a.emit(R(9,3,3,0x2a));a.branch(4,3,0,"done");a.emit(0);
    a.emit(I(9,9,9,2));a.emit(I(35,8,3,0x7bac));a.emit(0);
    a.emit(R(3,9,3,0x2a));a.branch(4,3,0,"storeHearts");a.emit(0);
    a.emit(I(35,8,9,0x7bac));a.emit(0);
    a.label("storeHearts");a.emit(I(43,8,9,0x7ba8));a.branch(4,0,0,"done");a.emit(0);
    a.label("done");a.emit(I(15,0,2,0x8004));a.emit(I(35,2,2,0xc8c4));
    a.emit(I(35,29,3,0));a.emit(I(35,29,8,4));a.emit(I(35,29,9,8));
    a.emit(R(31,0,0,8));a.emit(I(9,29,29,16));
    return a.finish();
  }

  function weaponCode(){
    const a=assembler(WEAPON_CAVE);
    a.branch(4,6,0,"unarmed");a.emit(0);
    a.emit(I(37,17,2,0x24));a.emit(I(15,0,3,0x8009));a.emit(I(35,3,3,0x7bb0));a.emit(0);
    a.emit(R(3,2,2,0x2a));a.branch(5,2,0,"noMp");a.emit(0);
    a.emit(R(31,0,0,8));a.emit(0);
    a.label("unarmed");a.emit(J(2,DRA_BASE+0x6F370));a.emit(0);
    a.label("noMp");a.emit(J(2,DRA_BASE+0x6FAC4));a.emit(R(0,0,2,0x21));
    return a.finish();
  }

  function patchDra(bytes){
    const b=bytes;
    const expected=[[0x61D38,0x3C028004],[HEART_HOOK,0x8C42C8C4],[0x61D40,0],
      [0x6F200,0x00438821],[WEAPON_HOOK,0x3266FFFF],[0x6F218,0x10C00055]];
    if(b.length<CAVE_END)throw new Error("DRA.BIN is too small for the gameplay patch.");
    for(const [at,word] of expected)if(u32(b,at)!==word)throw new Error(`Unsupported DRA.BIN code at 0x${at.toString(16)}; no gameplay patch was exported.`);
    if(![0x3042003F,0x3042001F].includes(u32(b,0x61D44)))throw new Error("Unsupported DRA.BIN code at 0x61d44; no gameplay patch was exported.");
    if(hashBlock(b,DEBUG_VIEWER,CAVE_END)!==DEBUG_VIEWER_HASH)throw new Error("Unsupported debug viewer code; no gameplay patch was exported.");
    const heart=heartCode(),weapon=weaponCode();
    if(heart.start+heart.bytes.length>WEAPON_CAVE||weapon.start+weapon.bytes.length>CAVE_END)throw new Error("Gameplay patch does not fit.");
    put32(b,DEBUG_VIEWER,0x03E00008);put32(b,DEBUG_VIEWER+4,0);
    b.set(heart.bytes,heart.start);b.set(weapon.bytes,weapon.start);
    put32(b,HEART_HOOK,J(3,DRA_BASE+HEART_CAVE));
    put32(b,WEAPON_HOOK,J(3,DRA_BASE+WEAPON_CAVE));
    put32(b,WEAPON_HOOK+4,0x3266FFFF);
  }

  function patchHeals(bytes,code,group){
    const hits=[];
    for(let at=8;at+4<=bytes.length;at+=4){
      if(u32(bytes,at)===0xA4222F78&&u32(bytes,at-4)===0x3C018007&&u32(bytes,at-8)===0x34020008)hits.push(at-8);
    }
    if(group==="ST"&&NO_HEAL.has(code)){
      if(hits.length)throw new Error(`Unexpected healing code in ${code}.`);
      return false;
    }
    if(hits.length!==2||hits[1]-hits[0]!==0x530)throw new Error(`Unsupported healing code in ${group}/${code}; no gameplay patch was exported.`);
    put32(bytes,hits[0],0x34020014);
    put32(bytes,hits[1],0x34020028);
    return true;
  }

  function validateAreas(group,dirs){
    const found=new Set();
    for(const dir of dirs){
      const code=CORE.normalizeIsoName(dir.name);
      if(!EXPECTED[group].has(code))throw new Error(`Unexpected ${group}/${code}; no gameplay patch was exported.`);
      found.add(code);
    }
    for(const code of EXPECTED[group])if(!found.has(code))throw new Error(`Missing ${group}/${code}; no gameplay patch was exported.`);
  }

  async function apply(disc,editable){
    const dra=await disc.findPath(["DRA.BIN"]);
    patchDra(await editable(dra));
    let patched=0;
    for(const group of ["ST","BOSS"]){
      const dirs=(await disc.readDirectory(await disc.findPath([group]))).filter(entry=>entry.isDirectory);
      validateAreas(group,dirs);
      for(const dir of dirs){
        const code=CORE.normalizeIsoName(dir.name);
        const files=await disc.readDirectory(dir);
        const record=files.find(entry=>!entry.isDirectory&&CORE.normalizeIsoName(entry.name)===`${code}.BIN`);
        if(!record)throw new Error(`Missing ${group}/${code}/${code}.BIN; no gameplay patch was exported.`);
        if(patchHeals(await editable(record),code,group))patched++;
      }
    }
    return patched;
  }

  const api={apply,patchDra,patchHeals,heartCode,weaponCode,validateAreas};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  global.SotnBuildStuff=api;
})(typeof window!=="undefined"?window:globalThis);
