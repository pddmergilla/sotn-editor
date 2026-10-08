const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../disc-stage.js'),EC=require('../entity-catalog.js'),C=require('../sotn-core.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const panel=part('  function formEntity(){','  function refreshRelicChoice(');
const apply=part('  $("applyEntity").onclick=','  $("duplicateEntity").onclick=');
function element(){
 const classes=new Set();
 return {children:[],value:'',disabled:false,textContent:'',
  appendChild(c){this.children.push(c);},replaceChildren(){this.children=[];this.value='';},
  classList:{toggle(n,on){if(on)classes.add(n);else classes.delete(n);},contains(n){return classes.has(n);}}
 };
}
function setup(stage,pot){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const state={discStage:stage,selectedEntity:pot},undo=[];
 const context={state,document:{createElement:element},$:get,Number,EC,
  activeEntityAreaCode:()=>stage.code,selectedTemplate:()=>null,
  dropRule:(code,e)=>S.dropRule(code,EC.typeFor(code,e.id).symbol,e.params,stage),
  dropGroups:()=>[],dropName:v=>'Reward '+v,fillSelect:(s,_,v)=>{s.value=String(v);},lookName:()=> 'urn',containerName:()=>null,
  entityEditState:()=>({dirty:!!stage.entitiesDirty}),restoreEntityEditState:p=>{stage.entitiesDirty=p.dirty;},
  pushUndo:(_,fn)=>undo.push(fn),markDirty:()=>{stage.entitiesDirty=true;},setStatus:()=>{},
  refreshRoomInfo:()=>{},redraw:()=>{}
 };
 vm.runInNewContext(panel+apply+'\nthis.refresh=refreshHeldItem;',context);
 context.refreshParamChoices=()=>context.refresh();
 context.refreshEntityFields=()=>{get('entityParams').value=pot.params;context.refresh();};
 for(const [field,key]of [['X','x'],['Y','y'],['Flags','flags'],['Slot','slot'],['Spawn','spawnId'],['Params','params']])get('entity'+field).value=pot[key];
 return {get,context,undo,state};
}
const pot={id:1,x:53,y:65,flags:0,slot:2,spawnId:3,params:0x716D};
const stage={code:'RNO2',prizeDrops:{values:Uint16Array.from([250,12,180,222,12,270,361,312,23,270,264,232])},entityLayouts:{entities:[[pot]]}};
const ui=setup(stage,pot);ui.context.refresh();
assert.equal(ui.get('entityHeldItem').disabled,true);
assert.equal(ui.get('heldSlotWrap').classList.contains('hidden'),false);
assert.equal(ui.get('entityPrizeSlot').value,'');
assert.equal(ui.get('entityPrizeSlot').children.length,13);
assert.match(ui.get('heldItemHint').textContent,/Choose a valid Item slot/);
const before=[...stage.prizeDrops.values];
for(const invalid of ['', '-1','12','1.5']){
 ui.get('entityPrizeSlot').value=invalid;ui.get('entityPrizeSlot').onchange();assert.equal(ui.get('entityParams').value,0x716D);
}
ui.get('entityPrizeSlot').value='0';ui.get('entityPrizeSlot').onchange();
assert.equal(ui.get('entityParams').value,0x7000);
assert.equal(ui.get('entityHeldItem').disabled,false);
assert.equal(pot.params,0x716D,'Slot choice waits for Apply Changes');
assert.deepEqual([...stage.prizeDrops.values],before);
ui.get('entityHeldItem').value='365';ui.get('applyEntity').onclick();
assert.equal(pot.params,0x7000);assert.equal(stage.prizeDrops.values[0],365);assert.equal(ui.undo.length,1);
assert.deepEqual([...stage.prizeDrops.values].slice(1),before.slice(1));
ui.undo.pop()();assert.equal(pot.params,0x716D);assert.deepEqual([...stage.prizeDrops.values],before);assert.equal(stage.entitiesDirty,false);
ui.context.refreshEntityFields();assert.equal(ui.get('entityHeldItem').disabled,true);
pot.params=0x776D;ui.context.refreshEntityFields();ui.get('entityPrizeSlot').value='11';ui.get('entityPrizeSlot').onchange();
assert.equal(ui.get('entityParams').value,0x760B,'Preserve appearance and upper parameter bits');
pot.params=0x0011;ui.context.refreshEntityFields();assert.equal(ui.get('heldSlotWrap').classList.contains('hidden'),true);
stage.code='LIB';pot.params=0x8005;ui.context.refreshEntityFields();assert.equal(ui.get('heldSlotWrap').classList.contains('hidden'),true);assert.equal(ui.get('entityHeldItem').disabled,true);

(async()=>{
 const bin=process.env.SOTN_BIN||`${process.env.USERPROFILE}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
 if(fs.existsSync(bin)){
  const disc=await C.DiscImage.open(await fs.openAsBlob(bin));
  const bytes=await disc.readFile(await disc.findPath(['ST','RNO2','RNO2.BIN']));
  const broken=S.parseOverlay(bytes);broken.code='RNO2';
  const layout=broken.rooms[3].entityLayoutId;
  for(const ptr of new Set([broken.xPtrs[layout],broken.yPtrs[layout]])){
   const bank=broken.banks.get(ptr),i=bank.originalEntries.findIndex(e=>e.id===1&&e.x===53&&e.y===65);
   new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint16(bank.start+i*10+8,0x716D,true);
  }
  const repaired=S.parseOverlay(bytes);repaired.code='RNO2';
  const values=Uint16Array.from({length:12},(_,i)=>bytes[repaired.prizeTableOffset+i*2]|bytes[repaired.prizeTableOffset+i*2+1]<<8);
  repaired.prizeDrops={offset:repaired.prizeTableOffset,original:values,values:values.slice()};
  const e=repaired.entityLayouts.entities[repaired.entityLayouts.indices[layout]].find(e=>e.id===1&&e.x===53&&e.y===65);
  const real=setup(repaired,e);real.context.refresh();real.get('entityPrizeSlot').value='0';real.get('entityPrizeSlot').onchange();real.get('entityHeldItem').value='365';real.get('applyEntity').onclick();
  const reopened=S.parseOverlay(S.buildOverlay(repaired,true));
  for(const ptr of new Set([reopened.xPtrs[layout],reopened.yPtrs[layout]]))assert.equal(reopened.banks.get(ptr).originalEntries.find(e=>e.id===1&&e.x===53&&e.y===65).params,0x7000);
  assert.equal(reopened.bytes[reopened.prizeTableOffset]|reopened.bytes[reopened.prizeTableOffset+1]<<8,365);
  real.undo.pop()();assert.deepEqual(S.buildOverlay(repaired,true),bytes,'Undo restores the damaged input without exporting it');
 }
 console.log('Pot slot selection, Apply, Undo and both placement copies passed.');
})().catch(e=>{console.error(e);process.exit(1);});
