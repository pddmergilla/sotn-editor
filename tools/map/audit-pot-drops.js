const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../../sotn-core.js'),S=require('../../disc-stage.js'),EC=require('../../entity-catalog.js'),M=require('../../stats-model.js');
const {machine}=require('../../tests/helpers/mips.js');
const root=process.env.SOTN_DECOMP||'D:/AAA/GitHub/sotn-decomp';
const bin=process.env.SOTN_BIN||'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const u32=(b,o)=>Buffer.from(b.buffer,b.byteOffset,b.byteLength).readUInt32LE(o),u16=(b,o)=>b[o]|b[o+1]<<8;
const hex=n=>'0x'+n.toString(16).toUpperCase();
function metadata(code,directory,b){
 const tag=(directory==='ST'?'st':'bo')+code.toLowerCase();
 const configPath=path.join(root,'config',`splat.us.${tag}.yaml`);
 const yaml=fs.existsSync(configPath)?fs.readFileSync(configPath,'utf8'):'';
 const segments=[...yaml.matchAll(/\[0x([a-f\d]+),\s*([^,\]]+)(?:,\s*([^\]\s]+))?\]/gi)].map(m=>({offset:parseInt(m[1],16),type:m[2],name:m[3]}));
 const symPath=path.join(root,'config',`symbols.us.${tag}.txt`);
 const symText=fs.existsSync(symPath)?fs.readFileSync(symPath,'utf8'):'';
 const symbols=Object.fromEntries([...symText.matchAll(/^(\w+)\s*=\s*0x([a-f\d]+);/gmi)].map(m=>[m[1],parseInt(m[2],16)]));
 const init=segments.findIndex(s=>s.name==='e_init'||s.name==='en_init');
 let table=-1;
 for(let o=init<0?0:segments[init].offset;o<(init<0?0x1000:segments[init+1].offset);o+=4){if(Array.from({length:12},(_,i)=>u32(b,o+i*4)).every(v=>v>=0x80180000&&v<0x80180000+b.length)){table=o;break;}}
 if(table<0)throw Error('No entity update table');
 const begin=u32(b,table)-0x80180000,ends=[];
 for(let o=table;o+4<b.length;o+=4){const p=u32(b,o);if(p<0x80180000||p>=0x80180000+b.length)break;if(p-0x80180000>begin)ends.push(p-0x80180000);}
 const end=Math.min(...ends,segments.find(s=>s.type==='c'&&s.offset>begin)?.offset||Infinity);
 for(let o=begin;o<end;o+=4){const w=u32(b,o);if(![2,3].includes(w>>>26))continue;const addr=(0x80000000|((w&0x3ffffff)<<2))>>>0,at=addr-0x80180000;if(at<0||at+180>b.length||at>=begin&&at<end)continue;
  const words=[];for(let i=0;i<100&&at+i*4+4<=b.length;i++){const w=u32(b,at+i*4);words.push(w);if(w===0x03E00008)break;}
  if(words.some(w=>(w>>>26)===12&&(w&0xffff)===0xFFF)&&words.some(w=>(w>>>26)===11&&(w&0xffff)===128)&&words.some(w=>(w>>>26)===41&&(w&0xffff)===0x26))symbols.ReplaceBreakableWithItemDrop=addr;
  if(words[0]===0x27BDFFE8&&words[1]===0xAFB00010&&words[2]===0x00808021&&words[3]===0x0205102B)symbols.AllocEntity=addr;
  if(words[0]===0x27BDFFE0&&words[1]===0xAFB10014&&words[2]===0x00A08821&&words[3]===0xAFB00010&&words[4]===0x00808021)symbols.CreateEntityFromCurrentEntity=addr;
  if(words[0]===0x27BDFFE0&&words[1]===0xAFB20018&&words[2]===0x00A09021&&words[3]===0xAFB10014&&words[4]===0x00C08821&&words[5]===0xAFB00010&&words[6]===0x00808021)symbols.CreateEntityFromEntity=addr;
 }
 const prize=segments.findIndex(s=>s.name==='d_prize_drops');
 const prizeOffset=S.findPrizeTable(b),next=segments.find(s=>s.offset>prizeOffset);
 return {symbols,table,begin,end,prizeLength:code==='RNO4'?32:next?(next.offset-prizeOffset)/2:null};
}
function probe(b,meta,params){
 const self=0x80110000,created=[],hooks=new Map();let next=0x80120000,result=null;
 for(let o=meta.begin;o<meta.end;o+=4){let w=u32(b,o);if(w>>>26===3)hooks.set((0x80000000|((w&0x3ffffff)<<2))>>>0,()=>{});}
 for(const [name,addr]of Object.entries(meta.symbols)){
  if(name==='AllocEntity')hooks.set(addr,r=>{r[2]=next;next+=0x100;});
  if(name==='CreateEntityFromEntity')hooks.set(addr,(r,m)=>{m.put(r[6]+0x26,2,r[4]);created.push({id:r[4],address:r[6]});});
  if(name==='CreateEntityFromCurrentEntity')hooks.set(addr,(r,m)=>{m.put(r[5]+0x26,2,r[4]);created.push({id:r[4],address:r[5]});});
  if(name==='ReplaceBreakableWithItemDrop')hooks.set(addr,()=>{result={kind:'direct',value:params&0xFFF};return 'stop';});
 }
 hooks.set(0x80001000,()=>{});
 const m=machine([{base:0x80180000,bytes:b}],hooks);
 for(let a=0x8003C670;a<0x8003C900;a+=4)m.put(a,4,0x80001000);
 m.put(self+0x30,2,params);m.put(self+0x2C,2,1);m.put(self+0x44,2,1);
 try{m.run(0x80180000+meta.begin,{4:self});}catch(e){return {error:e.message};}
 const children=created.filter(c=>c.id===12||c.id===11).map(c=>({kind:c.id===12?'slot':'relic',slot:m.get(c.address+0x30,2)}));
 return result||children.find(c=>c.kind==='slot')||children.find(c=>c.kind==='relic')||{kind:'none',created};
}
async function audit(d,overlays=new Map()){
 const dra=await d.readFile(await d.findPath(['DRA.BIN'])),model=M.parse({DRA:{bytes:dra,base:0x800A0000,label:'DRA'}});
 const names=new Map(model.sections.hand.map(h=>[128+h.index,model.get(h.name).trim()]));
 for(const h of Object.values(model.sections.body).flat())names.set(297+h.index,model.get(h.name).trim());
 for(const [i,name]of [[0,'Small heart'],[1,'Large heart'],[12,'Heart Max-Up'],[23,'Life Max-Up']])names.set(i,name);
 const stages=[],pots=[],issues=[];
 for(const entry of await d.listStages()){
  try{
   if(entry.code==='SEL'){stages.push({code:'SEL',excluded:'File-select menu; no stage rooms.'});continue;}
   const b=overlays.get(entry.code)||await d.readFile(entry.overlay),s=S.parseOverlay(b),meta=metadata(entry.code,entry.directory,b),seen=new Map();
   s.rooms.forEach((room,ri)=>{
    if(room.entityLayoutId<0)return;
    for(const [copy,ptr]of [['X',s.xPtrs[room.entityLayoutId]],['Y',s.yPtrs[room.entityLayoutId]]])for(const e of s.banks.get(ptr)?.originalEntries||[]){
     if(e.id!==1||e.x<0)continue;const key=[room.entityLayoutId,e.x,e.y,e.id,e.params,e.slot,e.spawnId].join(',');
     if(!seen.has(key))seen.set(key,{code:entry.code,directory:entry.directory,room:ri,layout:room.entityLayoutId,...e,copies:[]});seen.get(key).copies.push(copy);
    }
   });
   const unique=[...new Set([...seen.values()].map(e=>e.params))],rules=new Map(unique.map(p=>[p,probe(b,meta,p)]));
   const stage={code:entry.code,directory:entry.directory,size:b.length,breakables:seen.size,prizeOffset:s.prizeTableOffset,prizeLength:meta.prizeLength,begin:hex(meta.begin),end:hex(meta.end),replace:meta.symbols.ReplaceBreakableWithItemDrop,rules:Object.fromEntries(rules)};
   stages.push(stage);
   for(const e of seen.values()){
    const actual=rules.get(e.params),editor=S.dropRule(entry.code,'E_BREAKABLE',e.params),slot=actual.slot;
    const value=actual.kind==='direct'?actual.value:actual.kind==='slot'&&s.prizeTableOffset>=0?u16(b,s.prizeTableOffset+slot*2):undefined;
    const info={...e,actual,editor,value,itemName:names.get(value),look:e.params>>12};pots.push(info);
    if(actual.error||actual.kind==='none')issues.push({...info,reason:'Unresolved runtime'});
    else if(actual.kind==='slot'&&(meta.prizeLength===null||slot>=meta.prizeLength||slot<0))issues.push({...info,reason:'Outside prize table'});
    else if(value!==undefined&&!(value<=23||value>=128&&value<=386))issues.push({...info,reason:'Invalid item ID'});
    else if(actual.kind==='slot'&&!(editor?.kind==='slot'&&editor.slot===slot||editor?.kind==='fixed'&&editor.slot===slot))issues.push({...info,reason:'Editor rule mismatch'});
   }
  }catch(e){stages.push({code:entry.code,error:e.message});}
 }
 return {stages,pots,issues};
}
if(require.main===module)(async()=>{
 const d=await C.DiscImage.open(await fs.openAsBlob(bin)),report=await audit(d);
 report.source={path:bin,sha256:crypto.createHash('sha256').update(fs.readFileSync(bin)).digest('hex').toUpperCase()};
 const output=process.argv[2]||'outputs/all-pots-audit.json';
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({output,stages:report.stages.length,pots:report.pots.length,issues:report.issues.map(e=>({code:e.code,room:e.room,x:e.x,y:e.y,reason:e.reason})),errors:report.stages.filter(s=>s.error)},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={audit,metadata,probe};
