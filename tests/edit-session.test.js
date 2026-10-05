const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const C = require("../sotn-core.js"), M = require("../stats-model.js"), D = require("../disc-stage.js");
const S = require("../edit-session.js");
const copy = value => JSON.parse(JSON.stringify(value));
function stageFixture(code = "NZ0") {
  const bytes = new Uint8Array(64);
  return {code, bytes, rooms:[{entityGfxId:0},{entityGfxId:3}], originalRoomGfxIds:[0,3],
    maps:new Map([[1,{offset:0,values:new Uint16Array(4),dirty:false}]]),
    tiledefs:new Map([[2,{offsets:[8,12,16,20],collisions:new Uint8Array(4),dirty:false}]]),
    originalEntities:[[{x:-2,y:-2,id:0,flags:0,slot:0,spawnId:0,params:0},{x:4,y:5,id:1,flags:0,slot:2,spawnId:3,params:4},{x:-1,y:-1,id:0,flags:0,slot:0,spawnId:0,params:0}]],
    prizeDrops:{offset:24,original:new Uint16Array(2),values:new Uint16Array(2)},entitiesDirty:false,
    entityLayouts:{entities:[]}};
}
function modelFixture() {
  const model = new M.StatsModel({});
  model.add({id:"str",label:"STR",kind:"int",file:"DRA",off:0,size:2,min:0,max:999,original:10});
  model.add({id:"shop",label:"Price",kind:"int",file:"ST/LIB",off:2,size:4,min:0,max:999,original:100});
  return model;
}
function setup() {
  const stage = stageFixture(); stage.entityLayouts.entities = copy(stage.originalEntities);
  return {stats:modelFixture(),stages:new Map([[stage.code,stage]]),stage};
}
async function snapshot(context) {
  return S.parse(JSON.stringify(await S.capture({...context,name:"source.bin",area:"NZ0"})));
}
async function unitChecks() {
  const original = setup(), stage = original.stage;
  original.stats.set("str",11); original.stats.set("shop",123);
  stage.maps.get(1).values[2]=42; stage.maps.get(1).dirty=true;
  stage.tiledefs.get(2).collisions[1]=7; stage.tiledefs.get(2).dirty=true;
  stage.entityLayouts.entities[0][1].params=50; stage.entitiesDirty=true;
  stage.rooms[0].entityGfxId=3; stage.templateSourceRooms=new Map([[0,1]]);
  stage.prizeDrops.values[1]=130;
  const saved = await snapshot(original);
  assert.equal(saved.format,"sotn-editor-edits"); assert.equal(saved.stages.length,1);
  const fresh = setup(), plan = await S.prepare(saved,fresh);
  const originalBank = fresh.stage.entityLayouts.entities[0];
  assert.equal(fresh.stats.get("str"),10,"validation leaves current edits intact");
  const undo = plan.apply();
  assert.equal(fresh.stats.get("str"),11); assert.equal(fresh.stats.get("shop"),123);
  assert.equal(fresh.stage.maps.get(1).values[2],42); assert.equal(fresh.stage.maps.get(1).dirty,true);
  assert.equal(fresh.stage.tiledefs.get(2).collisions[1],7);
  assert.equal(fresh.stage.entityLayouts.entities[0][1].params,50); assert.equal(fresh.stage.entitiesDirty,true);
  assert.equal(fresh.stage.rooms[0].entityGfxId,3); assert.equal(fresh.stage.templateSourceRooms.get(0),1);
  assert.equal(fresh.stage.prizeDrops.values[1],130);
  const again = await snapshot(fresh); delete again.savedAt; const expected = copy(saved); delete expected.savedAt;
  assert.deepEqual(again,expected,"restored work can be saved again");
  (await S.prepare(saved,fresh)).apply();
  undo();
  assert.equal(fresh.stats.get("str"),10); assert.equal(fresh.stage.maps.get(1).values[2],0);
  assert.equal(fresh.stage.maps.get(1).dirty,false); assert.equal(fresh.stage.entitiesDirty,false);
  assert.equal(fresh.stage.entityLayouts.entities[0][1].params,4); assert.equal(fresh.stage.rooms[0].entityGfxId,0);
  assert.equal(fresh.stage.entityLayouts.entities[0],originalBank,"earlier Undo actions keep their entity references");
  assert.equal(fresh.stage.prizeDrops.values[1],0); assert.equal(fresh.stage.templateSourceRooms,undefined);
  const merged = setup(); merged.stage.maps.get(1).values[0]=30; merged.stage.maps.get(1).dirty=true;
  (await S.prepare(saved,merged)).apply(); assert.equal(merged.stage.maps.get(1).values[0],30,"unrelated current paint survives");
  for (const damage of [
    file=>file.stats[1].to=1000,
    file=>file.stats.push(file.stats[0]),
    file=>file.stats[1].shape.off=123,
    file=>file.stages[0].maps[0].edits[0].index=-1,
    file=>file.stages[0].collisions[0].edits[0].to=256,
    file=>file.stages[0].entities[0].to[1].params=65536,
    file=>file.stages[0].entities[0].to[0].x=0,
    file=>file.stages[0].templates=[[0,123]],
    file=>file.stages[0].hash="bad",
    file=>file.hacks=[{id:"missing"}]
  ]) {
    const bad = copy(saved); damage(bad); const target = setup();
    await assert.rejects(S.prepare(bad,target));
    assert.equal(target.stats.get("str"),10); assert.equal(target.stage.maps.get(1).values[2],0);
    assert.equal(target.stage.entityLayouts.entities[0][1].params,4);
  }
  const conflicting = setup(); conflicting.stats.set("shop",200);
  await assert.rejects(S.prepare(saved,conflicting),/conflicts/); assert.equal(conflicting.stats.get("str"),10);
  const changed = setup(); changed.stage.bytes[60]=1;
  await assert.rejects(S.prepare(saved,changed),/changed in this BIN/);
  const invalidBuild = setup(); invalidBuild.stats.checks=[()=>"Shop needs an Exit option."];
  invalidBuild.stats.set("str",11);
  assert.throws(()=>M.apply(invalidBuild.stats,{}),/Exit/);
  assert.equal((await snapshot(invalidBuild)).stats[0].to,11,"saving does not run build checks");
  assert.throws(()=>S.parse("broken"),/valid JSON/); assert.throws(()=>S.parse('{"format":"other"}'),/format/);
  console.log("Saved edits: all edit types, merging, conflicts, damaged files, Undo and failed-build capture passed.");
}
function appHarness(context, core = C) {
  const source = fs.readFileSync(require.resolve("../app.js"),"utf8");
  const handlers = source.slice(source.indexOf("  async function saveCurrentEdits()"),source.indexOf("  async function exportResult("));
  const files = source.slice(source.indexOf("  async function collectChanges("),source.indexOf("  async function saveBlob("));
  let output;
  const sandbox = {window:{SotnEditSession:S,SotnStage:D,SotnStatsModel:M,SotnTitleCredits:{add:async(_,changes)=>changes}},
    state:{tileCanvasCache:new Map(),...context}, C:core, Blob, console, finishPainting(){},finishEntityDrag(){},updateSaveState(){},
    setStatus(){},alert(message){throw new Error(message);},roomGraphicsDirty:stage=>stage.rooms.some((room,i)=>room.entityGfxId!==stage.originalRoomGfxIds[i]),
    saveBlob:async(blob,name)=>{output={blob,name};},refreshEntityFields(){},refreshRoomInfo(){},redraw(){},redrawPalette(){},
    pushUndo(label,restore){sandbox.undo={label,restore};}};
  vm.runInNewContext(`${files}\n${handlers}\nthis.save=saveCurrentEdits;this.load=loadSavedEdits;this.collect=collectChanges;`,sandbox);
  return {sandbox,output:()=>output};
}
async function appChecks() {
  const context = setup(); context.stats.set("str",11);
  const app = appHarness({disc:{readFile:async()=>{throw new Error("file could not be read");}},
    discName:"source.bin",discStages:context.stages,statsModel:context.stats});
  await app.sandbox.save();
  const output = app.output(); assert.equal(output.name,"source.sotn-edits.json");
  assert.equal(S.parse(await output.blob.text()).stats[0].to,11);
  assert.equal(context.stats.get("str"),11,"saving retains the edit");
  const fresh = setup(), target = appHarness({disc:{},discName:"fresh.bin",discStages:fresh.stages,statsModel:fresh.stats,discStage:fresh.stage});
  target.sandbox.chooseFile=async()=>({file:output.blob});await target.sandbox.load();
  assert.equal(fresh.stats.get("str"),11);assert.equal(target.sandbox.undo.label,"loaded saved edits");
  target.sandbox.undo.restore();assert.equal(fresh.stats.get("str"),10);
  const bad=copy(S.parse(await output.blob.text()));bad.stats.push({...bad.stats[0],id:"missing"});
  target.sandbox.chooseFile=async()=>({file:new Blob([JSON.stringify(bad)])});
  await assert.rejects(target.sandbox.load(),/unavailable/);assert.equal(fresh.stats.get("str"),10);
  console.log("App Save current edits works with an unreadable source and keeps current edits.");
}
function hacksHarness(disc, customCatalog) {
  const window = {};
  if (customCatalog) window.SotnExtraHacks=customCatalog;
  else vm.runInNewContext(fs.readFileSync(require.resolve("../extra-hacks-catalog.js"),"utf8"),{window});
  const context = {window, TextEncoder, Uint8Array, console};
  vm.runInNewContext(fs.readFileSync(require.resolve("../extra-hacks-ui.js"),"utf8").replace("  const api = {", "  global.testToggle = toggle; global.testTune = (id, values) => tuning.set(id, values);\n  const api = {"),context);
  return {api:window.SotnExtraHacksUI,toggle:window.testToggle,tune:window.testTune,disc};
}
async function imageChecks() {
  const home = process.env.USERPROFILE || process.env.HOME;
  for (const path of [process.env.SOTN_VANILLA_BIN || `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`,
    process.env.SOTN_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`,
    process.env.SOTN_ASS_OLD_BIN || `${home}/Downloads/Castlevania - Symphony of the Night Alter.bin`]) {
    if (!fs.existsSync(path)) { console.log(`Image unavailable: ${path}; skipped`); continue; }
    const hash = crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
    const disc = await C.DiscImage.open(await fs.openAsBlob(path));
    const model = await M.loadFromDisc(disc,C.normalizeIsoName);
    const catalog = await disc.listStages(), area = catalog.find(area=>area.code==="NZ0");
    const stage = D.parseOverlay(await disc.readFile(area.overlay)); stage.code="NZ0"; stage.record=area.overlay;
    const field = model.sections.alucard.fields.find(id=>model.field(id).key==="str"); model.set(field,model.get(field)+1);
    const map = [...stage.maps.values()][0]; map.values[0]=(map.values[0]+1)%map.values.length; map.dirty=true;
    const hacks = hacksHarness(disc); await hacks.api.setDisc(disc);
    const feature = hacks.api.analysis.features.find(info=>info.id==="fast-warp");
    if (feature && ["on","off"].includes(feature.state)) hacks.toggle(feature.id,feature.state!=="on");
    const bonus = hacks.api.catalog.features.find(feature=>feature.values?.some(def=>def.editable));
    if (bonus && hacks.api.analysis.features.find(info=>info.id===bonus.id)?.state==="on") {
      const info = hacks.api.analysis.features.find(info=>info.id===bonus.id), def=bonus.values.find(def=>def.editable);
      hacks.tune(bonus.id,{[def.key]:info.values[def.key]+1});
    }
    const saved = S.parse(JSON.stringify(await S.capture({name:disc.file.name,stats:model,stages:new Map([["NZ0",stage]]),hacks:hacks.api})));
    const freshDisc = await C.DiscImage.open(await fs.openAsBlob(path));
    const freshModel = await M.loadFromDisc(freshDisc,C.normalizeIsoName);
    const freshStage = D.parseOverlay(await freshDisc.readFile(area.overlay)); freshStage.code="NZ0";freshStage.record=area.overlay;
    const freshHacks = hacksHarness(freshDisc); await freshHacks.api.setDisc(freshDisc);
    const target = {stats:freshModel,stages:new Map([["NZ0",freshStage]]),hacks:freshHacks.api};
    const undo = (await S.prepare(saved,target)).apply();
    assert.equal(freshModel.get(field),model.get(field)); assert.equal([...freshStage.maps.values()][0].values[0],map.values[0]);
    assert.equal(JSON.stringify(freshHacks.api.captureSession()),JSON.stringify(saved.hacks));
    const freshSaved = copy(await S.capture({...target,name:disc.file.name})); delete freshSaved.savedAt; const expected = copy(saved);delete expected.savedAt;
    assert.deepEqual(freshSaved,expected);
    const originalApp = appHarness({disc,discStages:new Map([["NZ0",stage]]),statsModel:model});
    originalApp.sandbox.window.SotnExtraHacksUI=hacks.api;
    const restoredApp = appHarness({disc:freshDisc,discStages:target.stages,statsModel:freshModel});
    restoredApp.sandbox.window.SotnExtraHacksUI=freshHacks.api;
    assert.equal(JSON.stringify(await restoredApp.sandbox.collect()),JSON.stringify(await originalApp.sandbox.collect()),"restored BIN sectors match original editor work");
    undo(); assert.equal(freshModel.get(field),model.field(field).original);assert.equal(freshHacks.api.hasChanges(),false);
    if (saved.hacks.length) {
      const damaged = copy(saved);damaged.hacks[0].shape=-1;
      await assert.rejects(S.prepare(damaged,target),/incompatible/);assert.equal(freshModel.get(field),model.field(field).original);
      const impossible = copy(saved);impossible.hacks[0].values=[{key:"bad",from:0,to:1}];
      await assert.rejects(S.prepare(impossible,target),/invalid saved bonus/);
    }
    const lost = appHarness({disc:{readFile:async()=>{throw new Error("file could not be read");}},discName:"lost.bin",discStages:target.stages,statsModel:model});
    lost.sandbox.window.SotnExtraHacksUI=hacks.api;await lost.sandbox.save(); assert(lost.output());
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex"),hash,"source image remains intact");
    console.log(`${path}: saved/restored stats, map and ${saved.hacks.length} hack changes, repeat saves, export equality, Undo and source protection passed (${hash}).`);
  }
}
async function hackChecks() {
  const catalog={version:2,files:{},fingerprint:{windowLength:4,windowTolerance:0,windows:{},markers:[],minMarkerVotes:0,markerAgreement:0.9},features:[
    {id:"parent",label:"Parent",vanilla:true,defaults:{power:5},values:[{key:"power",file:"X",offset:4,editable:true,min:0,max:10}],edits:[{file:"X",offset:0,off:"00",on:"11"}]},
    {id:"child",label:"Child",vanilla:true,requires:["parent"],vanillaRequires:["parent"],edits:[{file:"X",offset:1,off:"00",on:"22"}]}
  ]};
  const disc={findPath:async()=>({size:8,extent:1}),readFile:async()=>Uint8Array.of(0,0,0,0,5,0,0,0)};
  const source=hacksHarness(disc,catalog);await source.api.setDisc(disc);
  source.toggle("child",true);source.tune("parent",{power:7});
  const saved=copy(source.api.captureSession());assert.equal(saved.length,2);assert.equal(saved[0].values[0].to,7);
  const fresh=hacksHarness(disc,catalog);await fresh.api.setDisc(disc);
  const restore=fresh.api.prepareSession(saved)();assert.equal(JSON.stringify(fresh.api.captureSession()),JSON.stringify(saved));
  const edits=fresh.api.pendingEdits();assert(edits[0].edits.some(edit=>edit.offset===4&&edit.bytes[0]===7));
  restore();assert.equal(fresh.api.hasChanges(),false);
  const bad=copy(saved);bad[0].to=false;assert.throws(()=>fresh.api.prepareSession(bad),/required hack/);
  const tooHigh=copy(saved);tooHigh[0].values[0].to=11;assert.throws(()=>fresh.api.prepareSession(tooHigh),/invalid saved bonus/);
  assert.equal(fresh.api.hasChanges(),false);
  fresh.api.init({onSelection(){throw new Error("Selection could not be restored.");}});
  assert.throws(()=>fresh.api.prepareSession(saved)(),/could not be restored/);assert.equal(fresh.api.hasChanges(),false);
  console.log("Saved Extra Hacks: dependencies, editable bonuses, corrupt values and Undo passed.");
}
(async()=>{await unitChecks();await appChecks();await hackChecks();await imageChecks();})().catch(error=>{console.error(error);process.exitCode=1;});
