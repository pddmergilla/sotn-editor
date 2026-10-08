const assert = require('node:assert/strict'), fs = require('node:fs');
const H = require('../tools/menu/system-settings'), K = require('../stats-core'), C = require('../sotn-core');
const {machine} = require('./helpers/mips');
const masks = [128,32,64,16,2,4,8,1];
function verify(dra) {
  const after = H.prepare(dra), code = [{base:H.BASE,bytes:after}], h = H.helper();
  const text = (vm,ptr) => { let s=''; for(let n=0;n<100;n++) {const c=vm.get(ptr+n,1);if(c===255)return s;s+=String.fromCharCode(c+32);}throw Error('Text did not end.'); };
  const vm = machine(code);
  const defaults=machine(code,new Map([[H.BASE+0x44B54,()=> 'stop']]));
  defaults.run(H.BASE+0x44B14);
  assert.equal(defaults.get(0x8003CA14,4),7);assert.equal(defaults.get(H.MASK,2),1);
  vm.put(0x8003C9F8,4,0);
  function permutation(a=[]) {
    if(a.length!==8) { for(let n=0;n<8;n++)if(!a.includes(n))permutation([...a,n]); return; }
    a.forEach((v,n)=>vm.put(0x8003C9F8+n*4,4,v));
    const out = vm.run(0x800F483C); assert.equal(out[2],1);
    a.forEach((v,n)=>{assert.equal(vm.get(0x8003C9F8+n*4,4),v);assert.equal(vm.get(0x8003CA18+n*2,2),masks[v]);});
  }
  permutation();
  for(let bad=0;bad<8;bad++)for(let dup=0;dup<8;dup++)if(bad!==dup){for(let n=0;n<8;n++)vm.put(0x8003C9F8+n*4,4,n===bad?dup:n);assert.equal(vm.run(0x800F483C)[2],0);}
  let seen=[], highlights=[];
  const draw = machine(code,new Map([
    [0x800F67EC,(r,m)=>{seen.push([text(m,r[4]>>>0),r[5],r[6]]);}],
    [0x800F678C,()=>{}], [0x800F5E68,(r,m)=>{highlights.push([r[6],m.get((r[29]+16)>>>0,4)]);}]
  ]));
  for(let n=0;n<8;n++)draw.put(0x8003C9F8+n*4,4,n);
  draw.run(0x800F6FA4,{4:0x80137600,17:12345});
  assert.equal(seen.length,8);assert.deepEqual(seen[7],['Item Shortcut',128,160]);assert.equal(highlights[0][1],108);
  assert.equal(K.u16(after,0x2E6C),124);assert.equal(K.u16(after,0x2E70),224);assert.equal(K.u16(after,0x2E72),128);
  for(const flag of [0,1]) {
    seen=[];draw.put(H.FLAG,1,flag);const out=draw.run(0x800F8374,{4:0x80137600,17:12345});
    assert.deepEqual(seen.at(-1),[`Show minimap: ${flag?'No':'Yes'}`,18,144]);assert.equal(out[17],12345);
  }
  let continuation=0,sounds=0;
  const input=machine(code,new Map([
    [0x800F9808,()=>{}],[0x800F99B8,(r,m)=>{let s='';for(let n=0;m.get((r[4]+n)>>>0,1);n++)s+=String.fromCharCode(m.get((r[4]+n)>>>0,1));assert.equal(s,'Show minimap: Left Yes / Right No');}],
    [0x801347F8,()=>{sounds++;}], ...[0x5C4C8,0x5C568,0x5D344].map(a=>[H.BASE+a,()=>{continuation=a;return 'stop';}])
  ]));
  for(const flag of [0,1])for(const tapped of [0,0x40,0x10,0x50])for(const repeat of [0,0x8000,0x2000,0xA000]) {
    input.put(H.FLAG,1,flag); input.put(0x8003C9E0,4,6);input.put(0x80097494,2,tapped);input.put(0x80097496,2,repeat);sounds=0;
    input.run(H.BASE+0x5C4C0,{16:0x8003C9E0});
    const expected=tapped&0x10?flag:tapped&0x40?flag^1:repeat&0x8000?0:repeat&0x2000?1:flag;
    assert.equal(input.get(H.FLAG,1),expected);assert.equal(continuation,tapped&0x10?0x5C568:0x5D344);
    assert.equal(sounds,!(tapped&0x10)&&((tapped&0x40)||(repeat&0xA000))?1:0);
  }
  for(let row=0;row<6;row++){input.put(0x8003C9E0,4,row);input.run(H.BASE+0x5C4C0,{16:0x8003C9E0});assert.equal(continuation,0x5C4C8);}
  let active=false;
  const shortcut=machine(code,new Map([[H.BASE+0x42608,()=>{active=true;return 'stop';}],[H.BASE+0x427A4,()=>{active=false;return 'stop';}]]));
  for(let layout=0;layout<8;layout++)for(let pressed=0;pressed<256;pressed++) {
    const assigned=masks.map((_,n)=>masks[(n+layout)%8]), mask=assigned[7];
    assigned.forEach((v,n)=>shortcut.put(0x8003CA18+n*2,2,v));
    const out=shortcut.run(H.BASE+0x42600,{9:pressed,10:pressed});assert.equal(active,!!(mask&pressed));
    if(active)assert.equal(out[10],assigned.slice(0,4).reduce((v,m,n)=>v|((pressed&m)?masks[n]:0),0));
  }
  assert.equal(K.u32(after,0x42650),0x01C07027);
  const suppress=machine(code,new Map([[H.BASE+0x42648,(r,m)=>{r[11]=0x80070000;r[15]=m.get(0x80072EEC,4);r[14]=~r[14];r[31]=H.BASE+0x42654;}],[H.BASE+0x4265C,()=> 'stop']]));
  for(let n=0;n<8;n++){suppress.put(0x800ACE00+n*4,4,1<<n);suppress.put(0x8003CA18+n*2,2,masks[(n+3)%8]);}
  suppress.put(0x80072EEC,4,255);suppress.run(H.BASE+0x4260C);assert.equal(suppress.get(0x80072EEC,4),240);
  let rendered=false;
  const minimap=machine(code,new Map([[H.BASE+0x42FB8,()=>{rendered=true;return 'stop';}],[H.BASE+0x43184,()=>{rendered=false;return 'stop';}]]));
  minimap.put(0x8003C734,4,2);minimap.put(0x8003C9A4,4,1);minimap.put(0x800974A0,4,0);
  for(const flag of [0,1]) {minimap.put(H.FLAG,1,flag);minimap.run(H.BASE+0x42F3C);assert.equal(rendered,!flag);}
  for(const at of [H.CAVE,0x57068,0x42600]) { const bad=dra.slice();bad[at]^=1;assert.throws(()=>H.prepare(bad)); }
  const allowed=[[H.CAVE,H.LIMIT],[0x2E6C,0x2E74],[0x5487C,0x54880],[0x54888,0x54890],
    [0x56FB4,0x56FB8],[0x56FF4,0x56FF8],[0x57068,0x5706C],[0x57088,0x5708C],[0x584B4,0x584BC],
    [0x5C4B4,0x5C4B8],[0x5C4C0,0x5C4C8],[0x5C698,0x5C69C],[0x42600,0x42608],[0x4261C,0x42620],[0x4262C,0x42630]];
  for(let n=0;n<dra.length;n++)if(dra[n]!==after[n])assert.ok(allowed.some(([a,z])=>n>=a&&n<z));
  return after;
}
async function main() {
  const source=process.env.SOTN_ASS_BIN||'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
  const d=await C.DiscImage.open(new Blob([fs.readFileSync(source)]));verify(await d.readFile(await d.findPath(['DRA.BIN'])));
  console.log('PASS: 40,320 button layouts, duplicate rejection, eight menu rows, minimap controls and draw gate, 2,048 shortcut cases, guards.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={verify};
