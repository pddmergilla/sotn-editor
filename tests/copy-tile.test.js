const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function element(id = "") {
  const handlers = {};
  const classes = new Set();
  return {
    id, handlers, children:[], value:"", checked:false, disabled:false, textContent:"",
    scrollTop:0,scrollLeft:0,clientHeight:300,scrollBy(options){this.scrollTop+=options.top;},
    classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
    attributes:{}, setAttribute(name,value){this.attributes[name]=value;},
    addEventListener(name,fn){handlers[name]=fn;},
    appendChild(child){this.children.push(child);},
    replaceChildren(){this.children=[];},
    getBoundingClientRect(){return {left:0,top:0,width:256,height:256};},
    getContext(){return context;}
  };
}

const markerArcs=[],brushRects=[];
const context = {
  save(){},restore(){},clearRect(){},fillRect(){},strokeRect(...args){brushRects.push(args);},drawImage(){},
  beginPath(){},arc(x,y,radius){markerArcs.push({x,y,radius});},fill(){},stroke(){},fillText(){},moveTo(){},lineTo(){}
};
const elements = new Map();
const get = id => {
  if(!elements.has(id))elements.set(id,element(id));
  return elements.get(id);
};
get("areaSelect").value="NZ0";
get("paintLayer").value="fg";
get("collisionLayer").value="fg";
get("showFg").checked=true;
get("showBg").checked=true;
get("showEntities").checked=true;
get("tileId").value="0";

const fg=new Uint16Array(256),bg=new Uint16Array(256);
fg[0]=11;fg[2]=12;bg[0]=22;bg[1]=23;
const tiledef={name:"tiledef:3",tiles:new Uint8Array(32),pages:new Uint8Array(32),cluts:new Uint8Array(32),collisions:new Uint8Array(32)};
tiledef.collisions[11]=5;tiledef.collisions[12]=1;tiledef.collisions[23]=8;
const stage={
  code:"NZ0",
  originalRoomGfxIds:[0,3],
  rooms:[
    {left:13,top:27,right:13,bottom:27,layerId:0,entityLayoutId:0,entityGfxId:0},
    {left:14,top:27,right:14,bottom:27,layerId:0,entityLayoutId:1,entityGfxId:3}
  ],
  layers:[{fg:{data:"map:1",tiledef:"tiledef:3",left:0,top:0,right:0,bottom:0,flags:0},
    bg:{data:"map:2",tiledef:"tiledef:3",left:0,top:0,right:0,bottom:0,flags:0}}],
  maps:new Map([[1,{path:"map:1",values:fg,dirty:false}],[2,{path:"map:2",values:bg,dirty:false}]]),
  tiledefs:new Map([[3,tiledef]]),
  entityLayouts:{indices:[0,1],entities:[[
    {x:-2,y:-2,id:0,flags:0,slot:0,spawnId:0,params:0},
    {x:72,y:132,id:1,flags:0,slot:2,spawnId:3,params:4},
    {x:120,y:100,id:35,flags:0,slot:6,spawnId:7,params:0x1234},
    {x:180,y:200,id:55,flags:0xA0,slot:9,spawnId:10,params:11},
    {x:-1,y:-1,id:0,flags:0,slot:0,spawnId:0,params:0}
  ],[
    {x:-2,y:-2,id:0,flags:0,slot:0,spawnId:0,params:0},
    {x:80,y:80,id:62,flags:0,slot:11,spawnId:0,params:2},
    {x:-1,y:-1,id:0,flags:0,slot:0,spawnId:0,params:0}
  ]]},
  xPtrs:[100],yPtrs:[200],banks:new Map([[100,{capacity:5}],[200,{capacity:5}]])
};
stage.originalEntities=stage.entityLayouts.entities.map(bank=>bank.map(entity=>({...entity})));
const disc={
  listStages:async()=>[{code:"NZ0",overlay:{},gfx:{}}],
  readFile:async record=>record===stage.record?new Uint8Array(64):new Uint8Array(0x8000)
};
const windowHandlers={};
const modes=["tiles","entities","collision"].map(mode=>Object.assign(element(`mode-${mode}`),{dataset:{mode}}));
const window={
  SotnCore:{DiscImage:{open:async()=>disc},decodeStagePages:()=>[],renderTileRGBA:()=>null},
  SotnStage:{parseOverlay:()=>stage,entityRepackCapacity:()=>0},
  SotnTitleCredits:{add:async(_,changes)=>changes},
  addEventListener(name,fn){windowHandlers[name]=fn;}
};
const documentHandlers={};
const document={
  getElementById:get,
  createElement:()=>element(),
  querySelectorAll(selector){
    if(selector===".room")return get("roomList").children;
    if(selector===".mode")return modes;
    return [];
  },
  addEventListener(name,fn){documentHandlers[name]=fn;}
};
const sandbox={window,document,console,alert:()=>{},confirm:()=>true,
  showOpenFilePicker:async()=>[{getFile:async()=>({name:"test.bin"})}]};
const core=require("../sotn-core.js");
disc.file=new Blob([new Uint8Array(64)]);disc.sectorSize=2048;disc.dataOffset=0;
stage.record={extent:0};stage.bytes=new Uint8Array(64);
window.SotnCore.modifiedBlob=core.modifiedBlob;
window.SotnCore.changedSectors=async(_,record,before,after)=>[{start:0,modified:after}];
window.SotnStage.buildOverlay=stage=>{const bytes=stage.bytes.slice();bytes[0]=stage.rooms[0].entityGfxId;return bytes;};
let testBuild;
window.SotnPlayLauncher={launch:async builder=>{testBuild=await builder();}};
vm.runInNewContext(fs.readFileSync(require.resolve("../entity-catalog.js"),"utf8"),sandbox);
vm.runInNewContext(fs.readFileSync(require.resolve("../entity-editor-model.js"),"utf8"),sandbox);
vm.runInNewContext(fs.readFileSync(require.resolve("../entity-templates.js"),"utf8"),sandbox);
vm.runInNewContext(fs.readFileSync(require.resolve("../app.js"),"utf8"),sandbox);

(async()=>{
  await get("openDisc").onclick();
  assert.equal(get("testGame").disabled,false);
  await get("testGame").onclick();
  assert.equal(testBuild.blob.size,disc.file.size);
  assert.deepEqual(new Uint8Array(await testBuild.blob.arrayBuffer()),new Uint8Array(64));
  assert.equal(get("templateRoom").disabled,false);
  get("templateRoom").value="1";get("templateRoom").onchange();
  assert.equal(stage.rooms[0].entityGfxId,3);
  assert.equal(get("buildBin").disabled,false);
  await get("testGame").onclick();
  assert.equal(new Uint8Array(await testBuild.blob.arrayBuffer())[0],3);
  assert.equal(new Uint8Array(await disc.file.arrayBuffer())[0],0);
  assert(get("newEntityType").children.some(group=>group.children.some(option=>option.value.startsWith("62:"))));
  get("undoEdit").onclick();
  assert.equal(stage.rooms[0].entityGfxId,0);
  assert.equal(get("templateRoom").value,"auto");
  assert.equal(get("buildBin").disabled,true);
  const copy=get("copyTile"),canvas=get("mapCanvas");
  assert.equal(get("exportPpf").disabled,true);
  assert.equal(copy.disabled,false);
  assert.equal(get("scrollDown").disabled,false);
  assert.equal(get("entityList").children.length,3);
  assert.match(get("entityList").children[0].textContent,/Breakable \(1 \/ 0x01\)/);
  assert.match(get("entityList").children[1].textContent,/Red Eye Bust \(35 \/ 0x23\)/);
  assert.match(get("entityList").children[2].textContent,/Relic Container \(55 \/ 0x37\)/);
  get("showEntities").checked=false;get("showEntities").onchange();
  markerArcs.length=0;
  modes[1].onclick();
  assert.deepEqual(markerArcs.map(point=>[point.x,point.y]),[[72,132],[120,100],[180,200]]);
  assert.equal(get("addEntity").disabled,true);
  assert.match(get("entityCapacityHint").textContent,/No safe space/);
  get("entityList").children[1].onclick();
  assert.equal(get("entityType").value,"35:0:4660:1");
  get("entityType").value="55:160:11:1";
  get("entityType").onchange();
  get("applyEntity").onclick();
  assert.equal(stage.entityLayouts.entities[0][2].id,55);
  assert.equal(stage.entityLayouts.entities[0][2].flags,0xA0);
  assert.equal(stage.entityLayouts.entities[0][2].slot,6);
  assert.equal(stage.entityLayouts.entities[0][2].spawnId,7);
  assert.equal(stage.entityLayouts.entities[0][2].params,11);
  window.SotnStage.entityRepackCapacity=()=>2;
  get("entityList").children[0].onclick();
  get("newEntityType").value="35:0:4660:1";
  assert.equal(get("addEntity").disabled,false);
  get("addEntity").onclick();
  const added=stage.entityLayouts.entities[0].at(-2);
  assert.equal(added.id,35);
  assert.equal(added.params,0x1234);
  assert.notEqual(added.slot,6);
  assert.notEqual(added.spawnId,7);
  get("undoEdit").onclick();
  assert.equal(stage.entityLayouts.entities[0].includes(added),false);
  canvas.handlers.mousedown({button:0,clientX:72,clientY:132});
  canvas.handlers.mousemove({clientX:90,clientY:150});
  windowHandlers.mouseup();
  assert.equal(stage.entityLayouts.entities[0][1].x,90);
  assert.equal(stage.entityLayouts.entities[0][1].y,150);
  modes[0].onclick();
  console.log("Entity panel interaction checks passed.");
  get("scrollDown").onclick();
  assert.equal(get("canvasWrap").scrollTop,240);
  get("scrollUp").onclick();
  assert.equal(get("canvasWrap").scrollTop,0);
  const wrap=get("canvasWrap");
  wrap.scrollLeft=80;wrap.scrollTop=90;
  canvas.handlers.mousedown({button:2,clientX:100,clientY:100});
  let prevented=false;
  wrap.handlers.mousedown({button:2,clientX:100,clientY:100,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(wrap.classList.contains("panning"),true);
  windowHandlers.mousemove({clientX:65,clientY:40});
  assert.equal(wrap.scrollLeft,115);
  assert.equal(wrap.scrollTop,150);
  windowHandlers.mouseup();
  assert.equal(wrap.classList.contains("panning"),false);
  windowHandlers.mousemove({clientX:0,clientY:0});
  assert.equal(wrap.scrollLeft,115);
  assert.equal(wrap.scrollTop,150);
  assert.equal(fg[0],11);
  const shortcut=(target=null)=>{
    let prevented=false;
    documentHandlers.keydown({key:"c",ctrlKey:true,target,preventDefault(){prevented=true;}});
    return prevented;
  };
  assert.equal(shortcut({closest:()=>true}),false);
  assert.equal(copy.attributes["aria-pressed"],"false");
  window.getSelection=()=>"selected text";
  assert.equal(shortcut(),false);
  window.getSelection=()=>"";
  assert.equal(shortcut(),true);
  assert.equal(copy.attributes["aria-pressed"],"true");
  documentHandlers.keydown({key:"Escape"});
  assert.equal(copy.attributes["aria-pressed"],"false");
  copy.onclick();
  assert.equal(copy.attributes["aria-pressed"],"true");
  canvas.handlers.mousedown({button:0,clientX:8,clientY:8});
  assert.equal(copy.attributes["aria-pressed"],"true");
  windowHandlers.mouseup();
  assert.equal(get("tileId").value,11);
  assert.equal(copy.attributes["aria-pressed"],"false");
  assert.equal(get("paintLayer").value,"fg");
  assert.equal(fg[0],11);

  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:24,clientY:8});
  windowHandlers.mouseup();
  assert.equal(get("tileId").value,23);
  assert.equal(get("paintLayer").value,"bg");
  assert.equal(copy.attributes["aria-pressed"],"false");
  assert.equal(bg[1],23);

  canvas.handlers.mousedown({button:0,clientX:40,clientY:8});
  windowHandlers.mouseup();
  assert.equal(bg[2],23);
  assert.equal(get("undoEdit").disabled,false);
  get("undoEdit").onclick();
  assert.equal(bg[2],0);

  get("paintLayer").value="fg";get("paintLayer").onchange();
  fg[0]=11;fg[1]=0;fg[16]=12;fg[17]=13;
  const beforeChunk=fg.slice();
  const priorSaveDisabled=get("buildBin").disabled;
  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:8,clientY:8});
  windowHandlers.mousemove({clientX:24,clientY:24});
  assert.equal(copy.attributes["aria-pressed"],"true");
  assert.deepEqual(fg,beforeChunk);
  windowHandlers.mouseup({button:0,clientX:24,clientY:24});
  assert.equal(copy.attributes["aria-pressed"],"false");
  assert.match(get("tileInfo").textContent,/2 × 2/);
  assert.equal(get("buildBin").disabled,priorSaveDisabled);
  fg[4]=31;fg[5]=31;fg[20]=31;fg[21]=31;
  const beforePaint=fg.slice();
  brushRects.length=0;
  canvas.handlers.mousemove({clientX:72,clientY:8});
  assert(brushRects.some(rect=>rect.join() === "65,1,30,30"));
  assert.deepEqual(fg,beforePaint);

  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:24,clientY:24});
  windowHandlers.mousemove({clientX:-100,clientY:-100});
  windowHandlers.mouseup();
  assert.match(get("tileInfo").textContent,/2 × 2/);
  assert.deepEqual(fg,beforePaint);

  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:8,clientY:8});
  windowHandlers.blur();windowHandlers.mouseup();
  assert.equal(copy.attributes["aria-pressed"],"true");
  assert.match(get("tileInfo").textContent,/2 × 2/);
  documentHandlers.keydown({key:"Escape"});

  get("paintLayer").value="bg";get("paintLayer").onchange();
  assert.doesNotMatch(get("tileInfo").textContent,/Copied brush/);
  get("showFg").checked=false;
  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:8,clientY:8});
  windowHandlers.mouseup({button:0,clientX:24,clientY:24});
  assert.equal(get("paintLayer").value,"bg");
  const beforeBackground=bg.slice();
  canvas.handlers.mousedown({button:0,clientX:72,clientY:8});
  windowHandlers.mouseup();
  assert.deepEqual([bg[4],bg[5],bg[20],bg[21]],[22,23,0,0]);
  assert.deepEqual(fg,beforePaint);
  get("undoEdit").onclick();
  assert.deepEqual(bg,beforeBackground);
  get("showFg").checked=true;
  get("tilePalette").handlers.mousedown({clientX:8,clientY:8});
  assert.doesNotMatch(get("tileInfo").textContent,/Copied brush/);

  get("paintLayer").value="fg";get("paintLayer").onchange();
  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:8,clientY:8});
  windowHandlers.mouseup({button:0,clientX:24,clientY:24});
  const originalDefinition=stage.tiledefs.get(3);
  stage.tiledefs.set(4,{...originalDefinition,name:"other-definition"});
  stage.layers.push({...stage.layers[0],fg:{...stage.layers[0].fg,tiledef:"tiledef:4"}});
  stage.rooms[1].layerId=1;
  await get("roomList").children[1].onclick();
  assert.doesNotMatch(get("tileInfo").textContent,/Copied brush/);
  stage.rooms[1].layerId=0;
  await get("roomList").children[0].onclick();
  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:8,clientY:8});
  windowHandlers.mouseup({button:0,clientX:24,clientY:24});
  canvas.handlers.mousedown({button:0,clientX:72,clientY:8});
  canvas.handlers.mousemove({clientX:104,clientY:8});
  windowHandlers.mouseup();
  assert.deepEqual([fg[4],fg[5],fg[20],fg[21]],[11,0,12,13]);
  assert.deepEqual([fg[6],fg[7],fg[22],fg[23]],[11,0,12,13]);
  get("undoEdit").onclick();
  assert.deepEqual(fg,beforePaint);
  assert.equal(get("buildBin").disabled,priorSaveDisabled);

  canvas.handlers.mousedown({button:0,clientX:72,clientY:8});
  canvas.handlers.mousemove({clientX:88,clientY:8});
  windowHandlers.mouseup();
  assert.deepEqual([fg[4],fg[5],fg[6],fg[20],fg[21],fg[22]],[11,11,0,12,12,13]);
  get("undoEdit").onclick();
  assert.deepEqual(fg,beforePaint);

  canvas.handlers.mousedown({button:0,clientX:248,clientY:248});
  windowHandlers.mouseup();
  assert.equal(fg[255],11);
  assert.equal(fg[240],beforePaint[240]);
  get("undoEdit").onclick();
  assert.deepEqual(fg,beforePaint);

  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:24,clientY:24});
  windowHandlers.mousemove({clientX:8,clientY:8});
  windowHandlers.mouseup();
  assert.match(get("tileInfo").textContent,/2 × 2/);
  await get("roomList").children[1].onclick();
  assert.match(get("tileInfo").textContent,/2 × 2/);
  canvas.handlers.mousedown({button:0,clientX:72,clientY:8});
  windowHandlers.mouseup();
  assert.deepEqual([fg[4],fg[5],fg[20],fg[21]],[11,0,12,13]);
  get("undoEdit").onclick();
  assert.deepEqual(fg,beforePaint);

  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:8,clientY:8});
  windowHandlers.mousemove({clientX:1000,clientY:1000});
  documentHandlers.keydown({key:"Escape"});
  windowHandlers.mouseup();
  assert.match(get("tileInfo").textContent,/2 × 2/);
  assert.deepEqual(fg,beforePaint);

  get("zoomIn").onclick();
  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:5,clientY:5});
  windowHandlers.mouseup({button:0,clientX:25,clientY:25});
  assert.match(get("tileInfo").textContent,/2 × 2/);
  get("zoomOut").onclick();
  get("tileId").value="14";get("tileId").onchange();
  assert.doesNotMatch(get("tileInfo").textContent,/Copied brush/);
  canvas.handlers.mousedown({button:0,clientX:72,clientY:8});
  windowHandlers.mouseup();
  assert.equal(fg[4],14);assert.equal(fg[5],31);
  get("undoEdit").onclick();
  assert.deepEqual(fg,beforePaint);

  copy.onclick();
  canvas.handlers.mousedown({button:0,clientX:300,clientY:8});
  assert.equal(copy.attributes["aria-pressed"],"true");
  await get("roomList").children[0].onclick();
  assert.equal(copy.attributes["aria-pressed"],"false");

  modes[2].onclick();
  const collisionCopy=get("copyCollision");
  assert.equal(collisionCopy.disabled,false);
  collisionCopy.onclick();
  canvas.handlers.mousedown({button:0,clientX:300,clientY:8});
  assert.equal(collisionCopy.attributes["aria-pressed"],"true");
  canvas.handlers.mousedown({button:0,clientX:8,clientY:8});
  assert.equal(get("collisionId").value,5);
  assert.equal(collisionCopy.attributes["aria-pressed"],"false");
  assert.equal(tiledef.collisions[11],5);
  canvas.handlers.mousedown({button:0,clientX:40,clientY:8});
  assert.equal(tiledef.collisions[12],5);
  get("undoEdit").onclick();
  assert.equal(tiledef.collisions[12],1);

  get("collisionLayer").value="bg";
  get("collisionLayer").onchange();
  collisionCopy.onclick();
  canvas.handlers.mousedown({button:0,clientX:24,clientY:8});
  assert.equal(get("collisionId").value,8);
  assert.equal(collisionCopy.attributes["aria-pressed"],"false");
  collisionCopy.onclick();
  documentHandlers.keydown({key:"Escape"});
  assert.equal(collisionCopy.attributes["aria-pressed"],"false");
  console.log("Copy Tile and Copy Collision tests passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
