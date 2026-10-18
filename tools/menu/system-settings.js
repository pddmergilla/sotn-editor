const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js'), M = require('../../stats-model.js');
const BASE = 0x800A0000, CAVE = 0x2F124, LIMIT = 0x2F324;
const FLAG = 0x8003C0E7, MASK = 0x8003CA26;
const NATIVE = [
  [0x44B14, 0x44B54, 'f5b01180b95b80a84be21b474096b89d69fa4cb18eda24553acc712e4c34e2ca'],
  [0x5483C, 0x54944, '326ebd77669d5a9190d93b59c6c5c530d3f4035934cfe64775b82c8ef6b6671c'],
  [0x56FA4, 0x570DC, 'dfb6d9103615272b774cd0753d456c677be9b12745743f9fd2ecd6cb114e28a3'],
  [0x58374, 0x584CC, '5b1135f88f391d34e24aa469f6f964e6437a80087afbbb7fd9fee2d4f0971075'],
  [0x5C478, 0x5C728, 'ddcafc089e4bbb79cf67404ac5debd9349ea7c4fb14f06690deb409556565292'],
  [0x425B8, 0x427EC, '5597b8ed0448edd18423db264b9193f28a068a883bc70917615d76c4721f6418'],
  [0x42F3C, 0x43264, '396f4cff4face1538dafd46f0c95aa1c4b21f35b84f6752ba7e497534b91abb1']
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const i = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;
const r = (fn, rs, rt, rd) => ((rs << 21) | (rt << 16) | (rd << 11) | fn) >>> 0;
const jump = (addr, call = false) => ((call ? 0x0C000000 : 0x08000000) | (addr >>> 2 & 0x3FFFFFF)) >>> 0;
const font = str => Buffer.from([...str].map(ch => ch.charCodeAt(0) - 32).concat([255, 0]));

function helper() {
  const words = [], labels = {}, branches = [], pointers = [];
  const emit = (...w) => words.push(...w);
  const label = name => { labels[name] = words.length * 4; };
  const branch = (op, rs, rt, name, slot = 0) => { branches.push([words.length, name]); emit(i(op, rs, rt, 0), slot); };
  const pointer = (reg, name) => { pointers.push([words.length, reg, name]); emit(0, 0); };
  const go = at => emit(jump(BASE + at), 0);
  label('draw');
  emit(i(15, 0, 8, 0x8004), i(36, 8, 8, 0xC0E7));
  pointer(4, 'yes'); branch(4, 8, 0, 'drawText'); pointer(4, 'no');
  label('drawText');
  emit(i(13, 0, 5, 18), i(13, 0, 6, 144), jump(0x800F67EC, true), r(0x21, 16, 0, 7), i(35, 29, 31, 0x28), i(35,29,17,0x24)); go(0x584BC);
  label('input');
  emit(jump(0x800F9808, true), i(13, 0, 4, 2), i(35, 16, 8, 0), i(13, 0, 9, 6));
  branch(4, 8, 9, 'mapInput'); go(0x5C4C8);
  label('mapInput');
  pointer(4, 'help'); emit(i(13, 0, 5, 2), jump(0x800F99B8, true), r(0x21, 0, 0, 6));
  emit(i(15, 0, 8, 0x8009), i(37, 8, 9, 0x7494), i(37, 8, 10, 0x7496), i(12, 9, 11, 0x10));
  branch(4, 11, 0, 'adjust'); go(0x5C568);
  label('adjust');
  emit(i(15, 0, 8, 0x8004), i(36, 8, 11, 0xC0E7), i(12, 9, 9, 0x40));
  branch(4, 9, 0, 'arrows'); emit(i(14, 11, 11, 1)); branch(4, 0, 0, 'store');
  label('arrows'); emit(i(12, 10, 9, 0x8000));
  branch(4, 9, 0, 'right'); emit(r(0x21, 0, 0, 11)); branch(4, 0, 0, 'store');
  label('right'); emit(i(12, 10, 9, 0x2000)); branch(4, 9, 0, 'exit'); emit(i(13, 0, 11, 1));
  label('store'); emit(i(40, 8, 11, 0xC0E7), jump(0x801347F8, true), i(13, 0, 4, 0x633));
  label('exit'); go(0x5D344);
  label('button'); emit(i(13, 0, 8, 7)); branch(5, 19, 8, 'buttonDraw'); pointer(4, 'item');
  label('buttonDraw'); emit(jump(0x800F67EC), 0);
  label('shortcut');
  emit(i(15, 0, 15, 0x8004), i(37, 15, 15, 0xCA26), 0, r(0x24, 9, 15, 9));
  branch(5, 9, 0, 'shortcutContinue'); go(0x427A4);
  label('shortcutContinue');
  emit(r(0x21,10,0,14),r(0x21,0,0,10),i(15,0,11,0x8004));
  for (const [n,mask] of [128,32,64,16].entries()) {
    emit(i(37,11,15,0xCA18+n*2),0,r(0x24,14,15,12)); branch(4,12,0,`next${n}`); emit(i(13,10,10,mask)); label(`next${n}`);
  }
  go(0x42608);
  const parts = [];
  for (const [name, str] of [['yes', 'Show minimap: Yes'], ['no', 'Show minimap: No'], ['item', 'Item Shortcut'], ['help', 'Show minimap: Left Yes / Right No']]) {
    labels[name] = words.length * 4 + parts.reduce((n,b) => n + b.length, 0); parts.push(name === 'help' ? Buffer.from(str+'\0','ascii') : font(str));
  }
  for (const [at, name] of branches) words[at] = K.withImmediate(words[at], (labels[name] - at * 4 - 4) / 4);
  for (const [at, reg, name] of pointers) { const addr = BASE + CAVE + labels[name]; words[at] = i(15, 0, reg, addr >>> 16); words[at + 1] = i(13, reg, reg, addr); }
  const code = Buffer.alloc(words.length * 4); words.forEach((w,n) => code.writeUInt32LE(w, n*4));
  const bytes = Buffer.concat([code, ...parts]); assert.ok(CAVE + bytes.length <= LIMIT, 'Settings space is full.');
  return {bytes, labels};
}

function prepare(dra) {
  for (const [a,z,h] of NATIVE) assert.equal(sha(dra.subarray(a,z)), h, `Settings code changed at ${a.toString(16)}.`);
  assert.ok(dra.subarray(CAVE,LIMIT).every(v => v === 0), 'Settings space is occupied.');
  const m = M.parse({DRA: {bytes: dra, base: BASE}});
  assert.ok([...m.sections.equipRows,...Object.values(m.sections.body).flat()].every(row => m.get(row.icon) < 316 || m.get(row.icon) > 319), 'An item uses settings artwork space.');
  for (let a = 0; a < 0x962A8; a += 4) {
    const w = K.u32(dra,a), op = w >>> 26;
    if (op === 2 || op === 3 || (a >= 0x42000 && [1,4,5,6,7].includes(op))) { const t = K.branchTarget(w,BASE+a); assert.ok(t < BASE+CAVE || t >= BASE+LIMIT, `Code uses settings space at ${a.toString(16)}.`); }
    assert.ok(w < BASE+CAVE || w >= BASE+LIMIT, 'A pointer uses settings space.');
  }
  const out = dra.slice(), h = helper(); out.set(h.bytes,CAVE);
  for (const [at, name, call] of [[0x584B4,'draw',false],[0x5C4C0,'input',false],[0x56FF4,'button',true],[0x42600,'shortcut',false]]) {
    K.put32(out,at,jump(BASE+CAVE+h.labels[name],call)); if (!call) K.put32(out,at+4,0);
  }
  K.put32(out,0x5487C,i(10,3,2,8)); K.put32(out,0x54888,jump(BASE+0x548C0)); K.put32(out,0x5488C,0);
  K.put32(out,0x57068,i(10,19,2,8)); K.put32(out,0x5C698,i(13,0,5,8)); K.put32(out,0x5C4B4,i(13,0,5,7));
  K.put32(out,0x56FB4,i(13,0,23,128)); K.put32(out,0x57088,i(13,0,2,108));
  K.put32(out,0x4261C,i(13,0,13,4)); K.put32(out,0x4262C,i(13,0,15,1));
  assert.equal(K.u16(out,0x2E72),112); K.put16(out,0x2E72,128); K.put16(out,0x2E6C,124); K.put16(out,0x2E70,224);
  return out;
}
module.exports = {BASE,CAVE,LIMIT,FLAG,MASK,NATIVE,helper,prepare,sha,jump};

const SLOTS = {
  staging: 0x18D00, end: 0x19F00, code: 0x8009C000, state: 0x8009D800,
  saved: 0x8003C0E8, cursor: 0x8003C9B0, step: 0x800978F8, list: 0x8009D820,
  overview: 0x80137658, selector: 0x80137676, defs: 0x800A4B04,
  guards: [
    [0x5ADC0,0x5AE98,'88885d7d753a0c93aec9611b613f1472cbe633fbed75b9f0a1c7f010dc9541fe'],
    [0x5B0FC,0x5B160,'1fe86c52eb72a4dec6d082ca9a1b081e30cea767f4cb3ed4a54fb807aee119e8'],
    [0x58990,0x58C00,'29f9c5e5924e67ce099879ad63b967c56e563a36df02b3eca153f67be2e577f9'],
    [0x593D4,0x59584,'5edfdfb5650402eda959910410bf6d89606aa7019bc5c7055657f146c0bd1c87'],
    [0x5A60C,0x5A808,'b2f118e4970719449b8a50b44174dc540de885ea7cfd8ce064bc93718c36d9bf'],
    [0x425B8,0x427F0,'7e3dd25e03b760cf951282560afc1231754c2d4477e08d0660101ad5eb0c649f'],
    [0x2F124,0x2F324,'b0bb25d71b8473ba82b9c4329d40809175d2538a7a221f884515b13df636d823'],
    [0x5E8B4,0x5E8F0,'86075096460a5b881643b2528d399e91c797eb9a42c8869360a259c2e2d26a7f'],
    [0x6EDB8,0x6FDF8,'ec1f651b3a14a035cb0dcf7e426b991e36d502a435b42074ac457606e028ff69']
  ]
};
const SLOT_HELP = 'To Use\uFF1APress L\uFF12\uFF0B Hand Button';
const SLOT_HELP_LEGACY = 'Choose medicine or food. L2 + hand button uses it.';
const SLOT_HELP_CAPACITY = 52;

function slotAssembler(base) {
  const regs = ['zero','at','v0','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7',
    's0','s1','s2','s3','s4','s5','s6','s7','t8','t9','k0','k1','gp','sp','fp','ra'];
  const reg = name => typeof name === 'number' ? name : regs.indexOf(name);
  const words=[], labels={}, fixes=[];
  const a={emit:(...w)=>words.push(...w), label:n=>{assert.ok(!(n in labels),n);labels[n]=base+words.length*4;},
    nop:()=>words.push(0), labels, here:()=>base+words.length*4};
  for (const [n,op] of Object.entries({lui:15,ori:13,andi:12,addiu:9,sltiu:11,lw:35,lhu:37,lbu:36,lh:33,sw:43,sh:41,sb:40})) {
    a[n] = n==='lui' ? (rt,imm)=>words.push(i(op,0,reg(rt),imm)) :
      ['lw','lhu','lbu','lh','sw','sh','sb'].includes(n) ? (rt,imm,rs)=>words.push(i(op,reg(rs),reg(rt),imm)) :
      (rt,rs,imm)=>words.push(i(op,reg(rs),reg(rt),imm));
  }
  for (const [n,f] of Object.entries({addu:0x21,subu:0x23,and:0x24,or:0x25,sltu:0x2B}))
    a[n]=(rd,rs,rt)=>words.push(r(f,reg(rs),reg(rt),reg(rd)));
  a.move=(rd,rs)=>a.addu(rd,rs,'zero');
  a.sll=(rd,rt,sh)=>words.push((reg(rt)<<16|reg(rd)<<11|sh<<6)>>>0);
  a.srl=(rd,rt,sh)=>words.push((reg(rt)<<16|reg(rd)<<11|sh<<6|2)>>>0);
  a.li=(rt,v)=>{a.lui(rt,v>>>16);a.ori(rt,rt,v);};
  a.ptr=(rt,label)=>{fixes.push([words.length,label,'ptr',reg(rt)]);a.emit(0,0);};
  a.j=t=>{if(typeof t==='string'){fixes.push([words.length,t,'j']);a.emit(0);}else a.emit(jump(t));a.nop();};
  a.call=t=>{if(typeof t==='string'){fixes.push([words.length,t,'call']);a.emit(0);}else a.emit(jump(t,true));a.nop();};
  a.branch=(op,rs,rt,label)=>{fixes.push([words.length,label,'branch']);a.emit(i(op,reg(rs),reg(rt),0),0);};
  a.beq=(rs,rt,l)=>a.branch(4,rs,rt,l);a.bne=(rs,rt,l)=>a.branch(5,rs,rt,l);a.b=l=>a.beq('zero','zero',l);
  a.ret=()=>a.emit(0x03E00008,0);
  a.load=(op,rt,addr)=>{a.li('t9',addr);a[op](rt,0,'t9');a.nop();};
  a.store=(op,rt,addr)=>{a.li('t9',addr);a[op](rt,0,'t9');};
  a.frame=(rs,extra=0)=>{const size=(16+rs.length*4+extra+7)&~7;a.addiu('sp','sp',-size);rs.forEach((r,n)=>a.sw(r,16+n*4,'sp'));return()=>{rs.forEach((r,n)=>a.lw(r,16+n*4,'sp'));a.nop();a.addiu('sp','sp',size);};};
  a.text=(label,str,ascii=false)=>{a.label(label);let b=Buffer.isBuffer(str)?str:ascii?Buffer.from(str+'\0','ascii'):font(str);while(b.length%4)b=Buffer.concat([b,Buffer.from([0])]);for(let n=0;n<b.length;n+=4)a.emit(b.readUInt32LE(n));};
  a.link=()=>{for(const [at,l,kind,rt]of fixes){assert.ok(l in labels,l);const v=labels[l];
    if(kind==='ptr'){words[at]=i(15,0,rt,v>>>16);words[at+1]=i(13,rt,rt,v);}
    else if(kind==='branch')words[at]=K.withImmediate(words[at],(v-base-at*4-4)/4);
    else words[at]=jump(v,kind==='call');}
    const out=Buffer.alloc(words.length*4);words.forEach((w,n)=>out.writeUInt32LE(w>>>0,n*4));return out;};
  return a;
}

function slotHelper(helpText=SLOT_HELP) {
  const a=slotAssembler(SLOTS.code), {cursor,step,defs,state,list,saved}=SLOTS;
  const row=()=>a.load('lw','t0',cursor);
  const finish=restore=>{restore();a.ret();};
  const count=()=>{a.li('t1',0x8009798A);a.addu('t1','t1','a0');a.lbu('v0',0,'t1');a.nop();};

  a.label('ensure');a.li('t0',saved);a.lhu('t1',2,'t0');a.ori('t2','zero',0x5351);
  a.beq('t1','t2','ensured');a.sh('zero',0,'t0');a.sh('t2',2,'t0');
  a.label('ensured');a.move('v0','t0');a.ret();

  a.label('valid');a.addiu('t0','a0',-1);a.sltiu('t0','t0',168);a.beq('t0','zero','invalid');
  a.ori('t0','zero',0x92);a.beq('a0','t0','invalid');a.ori('t0','zero',0x93);a.beq('a0','t0','invalid');
  a.sll('t0','a0',1);a.addu('t0','t0','a0');a.sll('t0','t0',2);a.addu('t0','t0','a0');a.sll('t0','t0',2);
  a.li('v0',defs);a.addu('v0','v0','t0');a.lbu('t1',14,'v0');a.ori('t2','zero',6);
  a.beq('t1','t2','validEnd');a.ori('t2','zero',10);a.beq('t1','t2','validEnd');
  a.label('invalid');a.move('v0','zero');a.label('validEnd');a.ret();

  a.label('get');let restore=a.frame(['ra','s0']);a.move('s0','a0');a.call('ensure');a.addu('t0','v0','s0');
  a.lbu('s0',0,'t0');a.nop();a.move('a0','s0');a.call('valid');a.move('v1','v0');
  a.bne('v0','zero','got');a.move('s0','zero');a.li('v1',defs);
  a.label('got');a.move('v0','s0');finish(restore);

  a.label('build');restore=a.frame(['ra','s0','s1','s2']);a.li('s0',list);a.sb('zero',0,'s0');a.ori('s1','zero',1);a.ori('s2','zero',1);
  a.label('buildLoop');a.move('a0','s1');a.call('valid');a.beq('v0','zero','buildNext');count();a.beq('v0','zero','buildNext');
  a.addu('t0','s0','s2');a.sb('s1',0,'t0');a.addiu('s2','s2',1);
  a.label('buildNext');a.addiu('s1','s1',1);a.sltiu('t0','s1',169);a.bne('t0','zero','buildLoop');
  a.store('sw','s2',state+8);a.move('v0','s2');finish(restore);

  a.label('caption');row();a.ori('t1','zero',8);a.ptr('v0','slot1');a.bne('t0','t1','captionEnd');a.ptr('v0','slot2');
  a.label('captionEnd');a.ret();

  a.label('description');row();a.sltiu('t1','t0',7);a.beq('t1','zero','slotDescription');
  a.emit(0x3C028004,0x8C42C9B0);a.j(BASE+0x5ADC8);
  a.label('slotDescription');restore=a.frame(['ra']);row();a.addiu('a0','t0',-7);a.call('get');a.lw('a0',4,'v1');
  a.lhu('a2',44,'v1');a.lhu('a3',46,'v1');a.ori('a1','zero',1);a.bne('v0','zero','showDescription');
  a.ptr('a0','help');a.label('showDescription');a.call(0x800FAD34);finish(restore);

  for(const [name,at,displaced]of [['setup',0x5B0FC,[0x3C038004,0x8C63C9B0]],['page',0x5A60C,[0x3C028013,0x8C4275CC]]]){
    a.label(name);row();a.sltiu('t1','t0',7);a.beq('t1','zero',name+'Slot');a.emit(...displaced);a.j(BASE+at+8);
    a.label(name+'Slot');if(name==='setup'){
      a.ori('t0','zero',4);a.store('sw','t0',0x801375CC);a.ori('t0','zero',3);a.store('sw','t0',0x801375D4);
      for(const at of [SLOTS.selector+18,SLOTS.selector+22])a.store('sh','zero',at);
      for(const at of [0x80137844,0x80137848,0x80137948])a.store('sw','zero',at);
    }a.ret();
  }

  a.label('title');row();a.sltiu('t1','t0',7);a.bne('t1','zero','nativeTitle');
  restore=a.frame(['ra','a1','a2','a3']);a.call('caption');a.move('a0','v0');restore();
  a.label('nativeTitle');a.j(0x800F67EC);

  a.label('overview');restore=a.frame(['ra','s0','s1','s2','s3']);a.move('s0','zero');a.ori('s1','zero',107);
  a.label('overviewLoop');a.move('a0','s0');a.call('get');a.move('s2','v1');a.lw('a0',0,'s2');a.nop();
  a.bne('v0','zero','overviewName');a.ptr('a0','slot1');a.beq('s0','zero','overviewName');a.ptr('a0','slot2');
  a.label('overviewName');a.ori('a1','zero',112);a.move('a2','s1');a.move('a3','s4');a.call(0x800F67EC);
  a.lhu('a0',44,'s2');a.lhu('a1',46,'s2');a.addiu('a2','s0',23);a.call(0x800EB534);
  a.addiu('s0','s0',1);a.addiu('s1','s1',13);a.sltiu('t0','s0',2);a.bne('t0','zero','overviewLoop');restore();a.move('s3','zero');a.ret();

  a.label('pickerDraw');row();a.sltiu('t1','t0',7);a.beq('t1','zero','customDraw');
  a.emit(0x27BDFF90,0xAFB60060);a.j(BASE+0x58998);
  a.label('customDraw');restore=a.frame(['ra','s0','s1','s2','s3','s4','s5','s6','s7'],8);a.move('s0','a0');a.call('build');a.move('s7','v0');
  row();a.addiu('t0','t0',-7);a.sll('t0','t0',2);a.li('s1',state);a.addu('s1','s1','t0');a.lw('s2',0,'s1');a.nop();
  a.sltu('t0','s2','s7');a.bne('t0','zero','cursorClamped');a.move('s2','zero');a.sw('zero',0,'s1');
  a.label('cursorClamped');a.srl('s3','s2',3);a.sll('s3','s3',3);a.move('s4','zero');
  a.label('drawLoop');a.addu('t0','s3','s4');a.sltu('t1','t0','s7');a.beq('t1','zero','drawEnd');a.li('t1',list);a.addu('t1','t1','t0');
  a.lbu('a0',0,'t1');a.nop();a.move('s5','a0');a.call('valid');a.move('s6','v0');a.bne('v0','zero','drawItem');a.li('s6',defs);
  a.label('drawItem');a.lhu('a0',44,'s6');a.lhu('a1',46,'s6');a.move('a2','s4');a.call(0x800EB534);
  a.andi('t0','s4',1);a.sll('t1','t0',5);a.sll('t0','t0',7);a.addu('t0','t0','t1');a.andi('t1','s4',1);a.sll('t1','t1',3);a.addu('t0','t0','t1');
  a.lh('t1',0,'s0');a.nop();a.addu('t0','t0','t1');a.addiu('t0','t0',40);a.sw('t0',52,'sp');
  a.srl('t0','s4',1);a.sll('t1','t0',1);a.addu('t0','t0','t1');a.sll('t0','t0',2);a.lh('t1',2,'s0');a.nop();a.addu('t0','t0','t1');a.addiu('t0','t0',4);a.sw('t0',56,'sp');
  a.move('a0','s4');a.lw('a1',52,'sp');a.lw('a2',56,'sp');a.nop();a.addiu('a1','a1',-16);a.addiu('a2','a2',-4);a.move('a3','s0');a.call(0x800F892C);
  a.lw('a0',0,'s6');a.nop();a.bne('s5','zero','drawName');a.call('caption');a.move('a0','v0');
  a.label('drawName');a.lw('a1',52,'sp');a.lw('a2',56,'sp');a.move('a3','s0');a.call(0x800F67EC);
  a.beq('s5','zero','drawHighlight');a.move('a0','s5');count();a.move('a0','v0');a.lw('a1',52,'sp');a.lw('a2',56,'sp');a.addiu('a1','a1',128);a.move('a3','s0');a.call(0x800F68F4);
  a.label('drawHighlight');a.addu('t0','s3','s4');a.bne('t0','s2','drawNext');a.load('lw','t0',step);a.ori('t1','zero',0x61);a.bne('t0','t1','drawNext');
  a.move('a0','s0');a.lw('a1',52,'sp');a.lw('a2',56,'sp');a.nop();a.addiu('a2','a2',-2);a.call(0x800F6508);
  a.label('drawNext');a.addiu('s4','s4',1);a.sltiu('t0','s4',8);a.bne('t0','zero','drawLoop');a.label('drawEnd');finish(restore);

  for(const [name,at,displaced]of [['pickInit',0x5D1DC,[0x3C048013,0x8C8475D4]],['pickInput',0x5D260,[0x3C108009,0x26107B36]]]){
    a.label(name);row();a.sltiu('t1','t0',7);a.beq('t1','zero','customInput');a.emit(...displaced);a.j(BASE+at+8);
  }
  a.label('customInput');restore=a.frame(['ra','s0','s1','s2','s3']);a.call('build');a.move('s3','v0');row();a.addiu('t0','t0',-7);a.move('s2','t0');a.sll('t0','t0',2);
  a.li('s0',state);a.addu('s0','s0','t0');a.load('lw','t0',step);a.ori('t1','zero',0x60);a.bne('t0','t1','handleInput');
  a.sw('zero',0,'s0');a.ori('t0','zero',0x61);a.store('sw','t0',step);a.li('s1',0xFFFFFFFF);a.b('inputControl');
  a.label('handleInput');a.lw('s1',0,'s0');a.nop();a.label('inputControl');a.move('a0','s0');a.move('a1','s3');a.ori('a2','zero',2);a.call(0x800FA034);
  a.load('lhu','t0',0x80097494);a.andi('t1','t0',0x10);a.bne('t1','zero','backToSlots');a.andi('t0','t0',0x40);a.beq('t0','zero','pickerInfo');
  a.call('ensure');a.addu('s2','s2','v0');a.lw('t0',0,'s0');a.li('t1',list);a.addu('t0','t0','t1');a.lbu('t0',0,'t0');a.nop();a.sb('t0',0,'s2');
  a.ori('a0','zero',0x633);a.call(0x801347F8);
  a.label('pickerInfo');a.lw('t0',0,'s0');a.nop();a.beq('t0','s1','inputEnd');a.li('t1',list);a.addu('t0','t0','t1');a.lbu('a0',0,'t0');a.nop();a.call('valid');a.move('s3','v0');
  a.bne('v0','zero','pickerDescription');a.li('s3',defs);
  a.label('pickerDescription');a.lw('a0',4,'s3');a.lhu('a2',44,'s3');a.lhu('a3',46,'s3');a.ori('a1','zero',1);a.bne('v0','zero','pickerDescriptionReady');a.ptr('a0','help');
  a.label('pickerDescriptionReady');a.call(0x800FAD34);a.b('inputEnd');
  a.label('backToSlots');a.ori('t0','zero',0x40);a.store('sw','t0',step);a.call('description');
  a.label('inputEnd');restore();a.j(BASE+0x5D344);

  a.label('use');restore=a.frame(['ra','s0','s1','s2','s3','s4']);a.move('s0','a0');a.call('valid');a.move('s1','v0');a.beq('v0','zero','useFailed');count();a.beq('v0','zero','useFailed');
  a.lbu('t0',14,'s1');a.ori('t1','zero',6);a.beq('t0','t1','checkHealing');a.lbu('t0',19,'s1');a.ori('t1','zero',55);a.bne('t0','t1','checkCost');
  a.lbu('t0',20,'s1');a.nop();a.addiu('t0','t0',-16);a.sltiu('t0','t0',3);a.beq('t0','zero','checkCost');
  a.label('checkHealing');a.load('lw','t0',0x80097BA0);a.load('lw','t1',0x80097BA4);a.sltu('t0','t0','t1');a.beq('t0','zero','useFailed');
  a.label('checkCost');
  a.lhu('a0',36,'s1');a.move('a1','zero');a.call(0x800FE8B4);a.bne('v0','zero','useFailed');
  a.load('lw','s2',0x80097C00);a.load('lw','s3',0x80072EE8);a.load('lw','s4',0x80072EEC);a.store('sw','s0',0x80097C00);
  a.lbu('t0',14,'s1');a.ori('t1','zero',6);a.beq('t0','t1','useFood');a.lbu('t0',15,'s1');a.ori('t1','zero',44);a.beq('t0','t1','useHearts');
  a.ori('t0','zero',0x80);a.store('sw','t0',0x80072EE8);a.store('sw','t0',0x80072EEC);a.call(0x8010EDB8);a.b('useRestored');
  a.label('useFood');a.ori('t0','zero',70);a.bne('s0','t0','useRealFood');a.call(0x800E2A80);a.beq('v0','zero','useRestored');a.b('chargeItem');
  a.label('useRealFood');a.move('a0','s0');a.call(0x800DB4E8);a.b('chargeItem');
  a.label('useHearts');a.ori('a0','zero',500);a.call(0x800FE914);
  a.label('chargeItem');a.move('a0','zero');a.call(0x800FDD44);a.lhu('a0',36,'s1');a.ori('a1','zero',1);a.call(0x800FE8B4);a.ori('v0','zero',1);
  a.label('useRestored');a.store('sw','s2',0x80097C00);a.store('sw','s3',0x80072EE8);a.store('sw','s4',0x80072EEC);a.b('useEnd');
  a.label('useFailed');a.move('v0','zero');a.label('useEnd');finish(restore);

  a.label('shortcut');restore=a.frame(['ra','v1','a0','a1','a2','a3','t0','t1','t2','t3','t4','t5','t6','t7','t8','t9','s0','s1']);
  a.load('lhu','t0',0x80097490);a.load('lhu','t1',MASK);a.and('t0','t0','t1');a.beq('t0','zero','shortcutEnd');
  a.li('t1',0xFFFFFF5F);for(const at of [0x80072EE8,0x80072EEC]){a.load('lw','t0',at);a.and('t0','t0','t1');a.store('sw','t0',at);}
  a.load('lhu','t0',0x80097494);a.load('lhu','t1',0x8003CA18);a.and('t1','t1','t0');a.move('s0','zero');a.bne('t1','zero','chosen');
  a.load('lhu','t1',0x8003CA1A);a.and('t1','t1','t0');a.beq('t1','zero','shortcutEnd');a.ori('s0','zero',1);
  a.label('chosen');a.move('a0','s0');a.call('get');a.move('s0','v0');a.beq('v0','zero','shortcutEnd');
  for(const [op,at]of [['lhu',0x80072F76],['lw',0x80072EFC]]){a.load(op,'t0',at);a.bne('t0','zero','shortcutEnd');}
  a.load('lw','t0',0x80072F2C);a.li('t1',0x40007);a.and('t0','t0','t1');a.bne('t0','zero','shortcutEnd');
  a.load('lhu','t0',0x80073404);a.sltiu('t0','t0',5);a.beq('t0','zero','shortcutEnd');a.load('lhu','t0',0x80073406);a.sltiu('t0','t0',0x40);a.beq('t0','zero','shortcutEnd');
  a.load('lw','t0',0x80097BA0);a.beq('t0','zero','shortcutEnd');a.move('a0','s0');a.call('use');
  a.label('shortcutEnd');restore();a.lui('v0',0x8009);a.lw('v0',0x744C,'v0');a.nop();a.ret();

  const help=Buffer.alloc(SLOT_HELP_CAPACITY), encoded=K.encodeSjis(helpText);
  assert.ok(encoded.length<=help.length,'The slot description is too long.');help.set(encoded);
  a.text('slot1','SLOT1');a.text('slot2','SLOT2');a.text('help',help);
  const bytes=a.link();assert.ok(bytes.length<=SLOTS.end-SLOTS.staging-128,`Slots need ${bytes.length} bytes.`);
  return {bytes,labels:a.labels};
}

function prepareSlots(dra) {
  for(const [a,z,h]of SLOTS.guards)assert.equal(sha(dra.subarray(a,z)),h,`Slot guard ${a.toString(16)}.`);
  assert.equal(K.u32(dra,0),0x800E3988);
  assert.ok(dra.subarray(SLOTS.staging,SLOTS.end).every(v=>v===0),'Slot staging space is occupied.');
  assert.equal(K.u16(dra,0x1807C+18),1);assert.equal(K.u16(dra,0x1807C+22),7);
  const out=dra.slice(), h=slotHelper(), boot=slotAssembler(BASE+SLOTS.staging);
  let restore=boot.frame(['ra']);boot.li('t0',BASE+SLOTS.staging+128);boot.li('t1',0xA009C000);boot.ori('t2','zero',h.bytes.length/4);
  boot.label('copy');boot.lw('t3',0,'t0');boot.addiu('t0','t0',4);boot.sw('t3',0,'t1');boot.addiu('t1','t1',4);boot.addiu('t2','t2',-1);boot.bne('t2','zero','copy');
  boot.li('t0',SLOTS.state);for(const off of [0,4,8])boot.sw('zero',off,'t0');
  boot.call(0x800192CC);restore();boot.j(0x800E3988);const loader=boot.link();assert.ok(loader.length<=128);
  out.set(loader,SLOTS.staging);out.set(h.bytes,SLOTS.staging+128);K.put32(out,0,BASE+SLOTS.staging);
  const hooks=[[0x425B8,'shortcut'],[0x5ADC0,'description'],[0x5B0FC,'setup'],[0x5A60C,'page'],[0x58990,'pickerDraw'],[0x5D1DC,'pickInit'],[0x5D260,'pickInput']];
  for(const [at,name]of hooks){K.put32(out,at,jump(h.labels[name]));K.put32(out,at+4,0);}
  assert.equal(K.u32(dra,0x594FC),0x00009821);K.put32(out,0x594FC,jump(h.labels.overview,true));
  assert.equal(K.u32(dra,0x57A68),jump(0x800F67EC,true));K.put32(out,0x57A68,jump(h.labels.title,true));
  for(const [at,was,to]of [[0x59540,0x2A620007,0x2A620009],[0x5CEB0,0x34050007,0x34050009],
    [0x5ACDC,0x34030007,0x34030009],[0x5AD18,0x34020006,0x34020008]]){
    assert.equal(K.u32(dra,at),was,`Slot navigation ${at.toString(16)}.`);K.put32(out,at,to);
  }
  for(const [at,was,to]of [[0x2E1E,97,123],[0x2E26,106,132],[0x2E2A,87,61]]){
    assert.equal(K.u16(dra,at),was);K.put16(out,at,to);
  }
  for(const [at,was,to]of [[0x5A698,12,10],[0x5A6A0,-12,-10],[0x5A6B0,72,60],[0x5A704,-12,-10],
    [0x5A718,12,10],[0x5A730,-5,-4],[0x5A748,-72,-60],[0x5A78C,13,11],[0x5A7A4,-5,-4]]){
    const w=K.u32(dra,at);assert.equal(w<<16>>16,was);K.put32(out,at,K.withImmediate(w,to));
  }
  return {after:out,helper:h,loader};
}
function prepareSlotDescription(dra) {
  const old=slotHelper(SLOT_HELP_LEGACY), next=slotHelper(), start=SLOTS.staging+128;
  assert.equal(old.bytes.length,next.bytes.length);assert.deepEqual(old.labels,next.labels);
  assert.deepEqual(Buffer.from(dra.subarray(start,start+old.bytes.length)),old.bytes,'The installed slot helper changed.');
  assert.equal(K.u32(dra,0),BASE+SLOTS.staging);
  assert.equal(K.u32(dra,0x5ADC0),jump(old.labels.description));
  assert.equal(K.u32(dra,0x5D1DC),jump(old.labels.pickInit));
  assert.equal(K.u32(dra,0x5D260),jump(old.labels.pickInput));
  const offset=start+next.labels.help-SLOTS.code, local=next.labels.help-SLOTS.code;
  const after=dra.slice();after.set(next.bytes.subarray(local,local+SLOT_HELP_CAPACITY),offset);
  assert.equal(K.decodeSjis(after,offset).text,SLOT_HELP);
  for(let n=0;n<dra.length;n++)if(dra[n]!==after[n])assert.ok(n>=offset&&n<offset+SLOT_HELP_CAPACITY);
  return {after,offset,helper:next};
}
function prepareSlotItemDescriptions(dra) {
  const helper=slotHelper(), start=SLOTS.staging+128;
  assert.deepEqual(Buffer.from(dra.subarray(start,start+helper.bytes.length)),helper.bytes,'The installed slot helper changed.');
  const model=M.parse({DRA:{bytes:dra,base:BASE}}), after=dra.slice(), edits=[];
  const wide=n=>String(n).replace(/[0-9]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xFEE0));
  for(const [id,button]of [[159,'Square'],[160,'Circle'],[161,'Triangle'],[70,'Cross']]){
    const row=model.sections.hand[id], field=model.field(row.desc), before=model.get(row.desc), cost=model.get(row.mp);
    assert.equal(field.readOnly,null);assert.equal(field.usedBy.length,1);
    assert.match(before,new RegExp('^L\uFF12\uFF0B'+button+' [\uFF10-\uFF19]+(?:Hearts|MP)$'),'The existing item description changed.');
    const resource=wide(cost&0x7FFF)+(cost&0x8000?'Hearts':'MP');
    const heal=id===70?null:model.get(row.heal);
    if(id!==70)assert.ok(Number.isInteger(heal)&&heal>=0&&heal<=9999,'The item healing value is unknown.');
    let text=id===70?'Random food'+resource:(heal===0?'Heals all HP':'Heals '+wide(heal)+'HP')+' '+resource;
    if(id!==70&&heal>0&&K.encodeSjis(text).length>field.capacity)text='Heals'+wide(heal)+'HP'+resource;
    const bytes=K.encodeSjis(text);
    assert.ok(bytes.length<=field.capacity,`${model.get(row.name)} description is too long.`);
    after.fill(0,field.off,field.off+field.capacity);after.set(bytes,field.off);
    assert.equal(K.decodeSjis(after,field.off).text,text);
    edits.push({id,name:model.get(row.name),before,text,offset:field.off,capacity:field.capacity,cost,heal});
  }
  for(let n=0;n<dra.length;n++)if(dra[n]!==after[n])assert.ok(edits.some(e=>n>=e.offset&&n<e.offset+e.capacity),'Unrelated item description bytes changed.');
  return {after,edits};
}
Object.assign(module.exports,{SLOTS,SLOT_HELP,SLOT_HELP_LEGACY,SLOT_HELP_CAPACITY,slotAssembler,slotHelper,prepareSlots,prepareSlotDescription,prepareSlotItemDescriptions});
