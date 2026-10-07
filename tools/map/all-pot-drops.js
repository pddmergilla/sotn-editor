const assert=require('node:assert/strict');
const S=require('../../disc-stage.js'),EC=require('../../entity-catalog.js');
const specs={
  RNO2:{offset:0xD40,original:[365,232,288,280,277,290,361,312,23,270,264,232],reserved:[6,7,8,9,10,11],targets:[
    {room:3,x:53,y:65,from:0x70FA,slot:0,item:250,name:'Mourneblade'},
    {room:3,x:101,y:65,from:0x700C,slot:1,item:12,name:'Heart Max-Up'},
    {room:3,x:149,y:65,from:0x70B4,slot:2,item:180,name:'Lunch B'},
    {room:6,x:161,y:497,from:0x70DE,slot:3,item:222,name:'Hunter sword'},
    {room:6,x:161,y:625,from:0x700C,slot:4,item:12,name:'Heart Max-Up'},
    {room:6,x:161,y:1137,from:0x710E,slot:5,item:270,name:'Heart Refresh'}
  ]},
  RLIB:{offset:0xBC8,length:18,reserved:[0,1,3,4,5,6,7,8],targets:[
    {room:4,x:140,y:344,from:0x90A4,slot:9,item:164,before:377,name:'Shop Card'}
  ]},
  RNO4:{offset:0x1620,length:32,reserved:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,21,22,23,24,25,26,27,28,29,30,31],targets:[
    {room:27,x:76,y:97,from:0x70BE,slot:16,item:190,before:198,name:'Sushi'}
  ]}
};
function repair(stage){
  const spec=specs[stage.code];assert(spec,'Unsupported pot repair.');
  assert.equal(stage.prizeTableOffset,spec.offset);
  const length=S.prizeTableLength(stage,0),b=Buffer.from(stage.bytes);
  assert.equal(length,spec.length||spec.original.length);
  const original=Uint16Array.from({length},(_,i)=>b.readUInt16LE(spec.offset+i*2));
  if(spec.original)assert.deepEqual([...original],spec.original,'The prize table changed.');
  const used=new Set(spec.reserved);
  for(const bank of stage.banks.values())for(const e of bank.originalEntries){
    if(e.x<0)continue;
    const rule=S.dropRule(stage.code,EC.typeFor(stage.code,e.id).symbol,e.params,stage);
    if(['slot','fixed'].includes(rule?.kind))used.add(rule.slot);
  }
  const edits=spec.targets.map(t=>{
    const room=stage.rooms[t.room];assert(room,'The pot room changed.');
    const bank=stage.entityLayouts.entities[stage.entityLayouts.indices[room.entityLayoutId]];
    const pots=bank.filter(e=>e.id===1&&e.x===t.x&&e.y===t.y);
    assert.equal(pots.length,1,'The pot placement changed.');assert.equal(pots[0].params,t.from,'The pot contents changed.');
    for(const ptr of new Set([stage.xPtrs[room.entityLayoutId],stage.yPtrs[room.entityLayoutId]])){
      const copies=stage.banks.get(ptr).originalEntries.filter(e=>e.id===1&&e.x===t.x&&e.y===t.y);
      assert.equal(copies.length,1);assert.equal(copies[0].params,t.from,'The other pot copy changed.');
    }
    assert(!used.has(t.slot),'The replacement prize slot is used.');used.add(t.slot);
    if(t.before!==undefined)assert.equal(original[t.slot],t.before,'The unused prize slot changed.');
    return {...t,entity:pots[0]};
  });
  stage.prizeDrops={offset:spec.offset,original,values:original.slice()};
  for(const t of edits){t.entity.params=(t.from&0xF000)|t.slot;stage.prizeDrops.values[t.slot]=t.item;}
  stage.entitiesDirty=true;
  return edits.map(({entity,...t})=>({...t,to:(t.from&0xF000)|t.slot}));
}
module.exports={specs,repair};
