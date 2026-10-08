(() => {
  "use strict";
  const C = window.SotnCore;
  const EC = window.SotnEntityCatalog;
  const EM = window.SotnEntityEditorModel;
  const ET = window.SotnEntityTemplates;
  const TILE_PX = 16;
  const CLUT_ALT_FLAG = 0x200;

  const state = {
    root:null, roomsFile:null, layersFile:null, entitiesFile:null,
    rooms:[], layers:[], entityLayouts:null, entitiesDirty:false,
    roomIndex:-1, room:null,
    fgEntry:null, bgEntry:null, fgTileDef:null, bgTileDef:null,
    tilemaps:new Map(), tiledefs:new Map(),
    stageBytes:null, stagePages:null, stageSource:null,
    disc:null, discHandle:null, discName:null, discStage:null, discStages:new Map(), areaCatalog:[],
    zoom:1, mode:"tiles", copyTileActive:false, copyCollisionActive:false, selectedEntity:null, draggingEntity:false,
    painting:false, paintStroke:null, entityDrag:null, pan:null, dirty:false, tileCanvasCache:new Map(), undoStack:[],
    tileBrush:null, copySelection:null, brushHover:null,
    tab:"map", statsModel:null, editRevision:0
  };

  const $ = id => document.getElementById(id);
  const canvas = $("mapCanvas");
  const ctx = canvas.getContext("2d", {alpha:true});
  const mapBase = document.createElement("canvas");
  const paletteCanvas = $("tilePalette");
  const pctx = paletteCanvas.getContext("2d", {alpha:true});

  function setStatus(msg) { for (const id of ["status","statsStatus","shopStatus"]) { const node=$(id); if(node) node.textContent = msg; } }
  function roomGraphicsDirty(stage) {
    return !!stage?.originalRoomGfxIds?.some((value,index)=>stage.rooms[index]?.entityGfxId!==value);
  }
  function updateSaveState() {
    state.editRevision++;
    if(state.discStage)state.discStage.entitiesDirty=state.entitiesDirty;
    const mapDirty = state.entitiesDirty || [...state.tilemaps.values()].some(e => e.dirty) || [...state.tiledefs.values()].some(td=>td.dirty) ||
      [...state.discStages.values()].some(s=>s.entitiesDirty||roomGraphicsDirty(s)||!!window.SotnStage.prizeDropsDirty?.(s)||[...s.maps.values()].some(m=>m.dirty)||[...s.tiledefs.values()].some(td=>td.dirty));
    state.dirty = mapDirty || !!state.statsModel?.dirty() || !!window.SotnExtraHacksUI?.hasChanges();
    const hasChanges=state.dirty;
    $("buildBin").disabled = !hasChanges || !state.disc;
    $("testGame").disabled = !state.disc;
    $("exportPpf").disabled = !hasChanges || !state.disc;
    $("saveEdits").disabled = !state.disc;
    $("loadEdits").disabled = !state.disc;
    $("saveAll").disabled = !mapDirty || !!state.discStage;
  }
  function markDirty(kind) {
    if (kind === "entities") state.entitiesDirty = true;
    updateSaveState();
    setStatus("Unsaved changes.");
  }
  function clearUndo() {
    state.undoStack.length=0;
    $("undoEdit").disabled=true;
  }
  function pushUndo(label,restore) {
    state.undoStack.push({label,restore});
    if(state.undoStack.length>100)state.undoStack.shift();
    $("undoEdit").disabled=false;
  }
  function entityEditState() {
    return {stage:state.discStage,dirty:state.entitiesDirty};
  }
  function restoreEntityEditState(previous) {
    if(previous.stage)previous.stage.entitiesDirty=previous.dirty;
    if(state.discStage===previous.stage)state.entitiesDirty=previous.dirty;
  }
  function undoEdit() {
    finishPainting();finishEntityDrag();
    const action=state.undoStack.pop();if(!action)return;
    action.restore();
    if(state.selectedEntity&&!currentEntityBank()?.includes(state.selectedEntity))state.selectedEntity=null;
    $("undoEdit").disabled=state.undoStack.length===0;
    refreshEntityFields();refreshRoomInfo();redraw();redrawPalette();window.SotnEditorView?.refreshAll();window.SotnExtraHacksUI?.refresh();updateSaveState();
    setStatus(`Undid ${action.label}.`);
  }

  async function resolvePath(root, path, wantDir=false) {
    const parts = String(path).replace(/\\/g,"/").split("/").filter(Boolean);
    let dir = root;
    for (let i=0;i<parts.length-1;i++) dir = await dir.getDirectoryHandle(parts[i]);
    if (!parts.length) return root;
    return wantDir ? dir.getDirectoryHandle(parts.at(-1)) : dir.getFileHandle(parts.at(-1));
  }
  function pathDir(path) {
    const p = String(path).replace(/\\/g,"/").split("/");
    p.pop(); return p.join("/");
  }
  function joinRel(base, child) {
    if (!base) return child;
    if (String(child).includes("/")) return child;
    return `${base}/${child}`;
  }
  async function maybeFile(path) {
    try { return await resolvePath(state.root,path,false); } catch { return null; }
  }
  async function readJson(handle) { return JSON.parse(await (await handle.getFile()).text()); }
  async function readBytes(handle) { return new Uint8Array(await (await handle.getFile()).arrayBuffer()); }
  async function readU16(handle) {
    const b = await readBytes(handle);
    const v = new DataView(b.buffer,b.byteOffset,b.byteLength);
    const out = new Uint16Array(Math.floor(b.byteLength/2));
    for (let i=0;i<out.length;i++) out[i]=v.getUint16(i*2,true);
    return out;
  }
  async function writeJson(handle,obj) {
    const w=await handle.createWritable(); await w.write(JSON.stringify(obj,null,2)+"\n"); await w.close();
  }
  async function writeU16(handle,values) {
    const buf=new ArrayBuffer(values.length*2), v=new DataView(buf);
    for(let i=0;i<values.length;i++)v.setUint16(i*2,values[i],true);
    const w=await handle.createWritable(); await w.write(buf); await w.close();
  }

  function normalizedRoom(r) {
    return {
      left:r.left??r.Left??0, top:r.top??r.Top??0, right:r.right??r.Right??0, bottom:r.bottom??r.Bottom??0,
      layerId:r.layerId??r.LayerID??0, tileDefId:r.tileDefId??r.TileDefID??0,
      entityGfxId:r.entityGfxId??r.EntityGfxID??0, entityLayoutId:r.entityLayoutId??r.EntityLayoutID??0, raw:r
    };
  }
  function layerForRoom(room) { return state.layers[room.layerId] || {}; }
  function layerDims(layer) {
    if(!layer)return null;
    const blocksW=layer.right-layer.left+1, blocksH=layer.bottom-layer.top+1;
    return {blocksW,blocksH,tilesW:blocksW*16,tilesH:blocksH*16};
  }
  function activeDims() {
    if(!state.room)return null;
    const lr=layerForRoom(state.room);
    return layerDims(lr.fg||lr.bg);
  }

  async function loadTilemap(path) {
    if(!path)return null;
    if(state.tilemaps.has(path))return state.tilemaps.get(path);
    if(state.discStage) {
      const entry=state.discStage.maps.get(Number(path.split(":")[1]));
      if(entry)state.tilemaps.set(path,entry);
      return entry||null;
    }
    const handle=await maybeFile(path);
    if(!handle)return null;
    const entry={path,handle,values:await readU16(handle),dirty:false};
    state.tilemaps.set(path,entry); return entry;
  }

  async function loadTileDef(jsonPath) {
    if(!jsonPath)return null;
    if(state.tiledefs.has(jsonPath))return state.tiledefs.get(jsonPath);
    if(state.discStage) {
      const td=state.discStage.tiledefs.get(Number(jsonPath.split(":")[1]));
      if(td)state.tiledefs.set(jsonPath,td);
      return td||null;
    }
    const h=await maybeFile(jsonPath); if(!h)return null;
    const desc=await readJson(h), base=pathDir(jsonPath);
    const tileH=await maybeFile(joinRel(base,desc.tiles));
    const pageH=await maybeFile(joinRel(base,desc.pages));
    const clutH=await maybeFile(joinRel(base,desc.cluts));
    const colH=await maybeFile(joinRel(base,desc.collisions));
    if(!tileH||!pageH||!clutH) return null;
    const td={
      name:jsonPath, desc,
      tiles:await readBytes(tileH), pages:await readBytes(pageH), cluts:await readBytes(clutH),
      collisions:colH?await readBytes(colH):null, collisionHandle:colH
    };
    state.tiledefs.set(jsonPath,td); return td;
  }

  function inferStageCode() {
    for(const lr of state.layers) for(const k of ["fg","bg"]) {
      const n=lr?.[k]?.data;
      const m=String(n||"").match(/(?:^|\/)([a-z0-9]+)_tilemap_/i);
      if(m)return m[1].toUpperCase();
    }
    return String(state.root?.name||"").toUpperCase();
  }

  async function openAreaFolder() {
    if(!window.showDirectoryPicker){alert("Use desktop Chrome/Edge; the editor needs File System Access.");return;}
    try {
      const root=await showDirectoryPicker({mode:"readwrite"}); state.root=root;state.discStage=null;state.disc=null;state.discStages.clear();
      $("areaSelect").replaceChildren();$("areaSelect").disabled=true;
      state.roomsFile=await resolvePath(root,"rooms.json");
      state.layersFile=await resolvePath(root,"layers.json");
      state.entitiesFile=await maybeFile("entity_layouts.json");
      state.rooms=(await readJson(state.roomsFile)).map(normalizedRoom);
      state.layers=await readJson(state.layersFile);
      state.entityLayouts=state.entitiesFile?await readJson(state.entitiesFile):null;
      state.tilemaps.clear(); state.tiledefs.clear(); state.entitiesDirty=false;clearUndo();
      $("areaName").textContent=`${root.name} (${inferStageCode()})`;
      renderRoomList();
      if(state.disc) await loadStageFromDisc(false);
      if(state.rooms.length)await selectRoom(0);
      updateSaveState();
      setStatus(`Loaded ${state.rooms.length} rooms.`);
    } catch(e){ if(e.name!=="AbortError"){console.error(e);alert(e.message||e);} }
  }

  function renderRoomList() {
    const list=$("roomList"); list.innerHTML="";
    state.rooms.forEach((r,i)=>{
      const b=document.createElement("button"); b.className="room";
      b.textContent=`Room ${String(i).padStart(2,"0")} [${r.left},${r.top}]–[${r.right},${r.bottom}]`;
      b.onclick=()=>selectRoom(i); list.appendChild(b);
    });
  }

  async function selectRoom(i) {
    finishPainting();
    state.brushHover=null;
    setCopyTile(false);
    setCopyCollision(false);
    state.roomIndex=i; state.room=state.rooms[i]; state.selectedEntity=null;
    $("copyTile").disabled=false;
    $("scrollUp").disabled=false;$("scrollDown").disabled=false;
    document.querySelectorAll(".room").forEach((el,idx)=>el.classList.toggle("active",idx===i));
    const lr=layerForRoom(state.room);
    state.fgEntry=lr.fg?.data?await loadTilemap(lr.fg.data):null;
    state.bgEntry=lr.bg?.data?await loadTilemap(lr.bg.data):null;
    state.fgTileDef=lr.fg?.tiledef?await loadTileDef(lr.fg.tiledef):null;
    state.bgTileDef=lr.bg?.tiledef?await loadTileDef(lr.bg.tiledef):null;
    if(state.tileBrush&&state.tileBrush.td!==currentPaintLayer().td)state.tileBrush=null;
    updateCollisionAvailability();
    refreshEntityFields(); redraw(); redrawPalette();
    $("canvasWrap").scrollTop=0;
    refreshRoomInfo();
  }
  function refreshRoomInfo() {
    if(!state.room)return;
    const bank=currentEntityBank();
    $("roomInfo").textContent=`Room ${state.roomIndex} • layer ${state.room.layerId} • entity layout ${state.room.entityLayoutId} • ${bank?Math.max(0,bank.length-2):0} entities`;
  }

  async function chooseFile() {
    if(typeof showOpenFilePicker === "function") {
      const [h]=await showOpenFilePicker({multiple:false});
      return {handle:h,file:await h.getFile()};
    }
    return new Promise((resolve,reject)=>{
      const input=document.createElement("input");
      input.type="file";input.hidden=true;
      const finish=file=>{
        input.remove();
        if(file)resolve({handle:null,file});
        else reject(new DOMException("No file selected.","AbortError"));
      };
      input.onchange=()=>finish(input.files?.[0]);
      input.oncancel=()=>finish(null);
      document.body.appendChild(input);
      try{input.click();}catch(error){input.remove();reject(error);}
    });
  }

  async function openDisc() {
    try {
      if(state.dirty&&!confirm("Open another BIN and discard current edits? Use Save current edits first to keep them."))return;
      const {handle,file}=await chooseFile();
      setStatus("Reading disc filesystem...");
      const disc=await C.DiscImage.open(file);
      const catalog=(await disc.listStages()).filter(a=>AREA_NAMES[a.code]&&a.code!=="MAD"&&a.code!=="ST0");
      if(!catalog.length)throw new Error("No supported castle areas found in this BIN.");
      state.disc=disc;state.discHandle=handle;state.discName=file.name;
      state.root=null;state.discStage=null;state.discStages.clear();clearUndo();
      window.SotnExtraHacksUI?.setDisc(disc);
      window.SotnAss2UI?.setDisc(disc,{name:file.name,handle});
      state.areaCatalog=catalog.sort((a,b)=>AREA_NAMES[a.code].localeCompare(AREA_NAMES[b.code]));
      const select=$("areaSelect");select.replaceChildren();
      for(const [label,areas] of [
        ["Normal Castle",state.areaCatalog.filter(a=>a.directory!=="BOSS"&&!a.code.startsWith("R"))],
        ["Normal Castle Boss Rooms",state.areaCatalog.filter(a=>a.directory==="BOSS"&&!a.code.startsWith("R"))],
        ["Reverse Castle",state.areaCatalog.filter(a=>a.directory!=="BOSS"&&a.code.startsWith("R"))],
        ["Reverse Castle Boss Rooms",state.areaCatalog.filter(a=>a.directory==="BOSS"&&a.code.startsWith("R"))]
      ]) {
        if(!areas.length)continue;
        const group=document.createElement("optgroup");group.label=label;
        for(const area of areas) {
          const option=document.createElement("option");option.value=area.code;
          option.textContent=`${AREA_NAMES[area.code]} (${area.code})`;
          group.appendChild(option);
        }
        select.appendChild(group);
      }
      select.disabled=!state.areaCatalog.length;
      await selectDiscArea(select.value);
      await loadStats(disc);
      setStatus(`Loaded ${file.name}. ${state.statsModel?"Map and stats are ready.":"The map is ready; stats could not be read."}`);
    } catch(e){if(e.name!=="AbortError"){console.error(e);alert(e.message||e);}}
  }

  // Item costs that the Extra Hacks selection sets go through the stats model, so the Stats Editor
  // shows them (as heart costs with Healing items use Hearts) before the build and writes them.
  let hackCosts=[],pushedCosts=new Set();
  const costField=(file,offset)=>{const id=file==="DRA.BIN"?`DRA:${offset.toString(16)}:2`:null;return id&&state.statsModel?.field(id)?id:null;};
  function applyHackCosts() {
    const m=state.statsModel;
    if(!m)return;
    for(const {file,offset,value} of hackCosts) {
      const id=costField(file,offset);
      if(!id)continue;
      if(value===null){if(pushedCosts.has(id)){m.reset(id);pushedCosts.delete(id);}}
      else{m.set(id,value);pushedCosts.add(id);}
    }
    window.SotnStatsUI?.render();window.SotnShopUI?.refresh?.();
  }

  async function loadStats(disc) {
    state.statsModel=null;pushedCosts=new Set();
    if(!window.SotnStatsModel)return;
    try {
      state.statsModel=await window.SotnStatsModel.loadFromDisc(disc,C.normalizeIsoName,setStatus);
      window.SotnStatsUI?.setModel(state.statsModel);
      window.SotnShopUI?.setModel(state.statsModel);
      applyHackCosts();
    } catch(e) {
      console.error(e);
      window.SotnStatsUI?.setModel(null);
      window.SotnShopUI?.setModel(null);
      $("statsEmptyText").textContent=`Stats could not be read from this BIN: ${e.message||e}`;
      if($("shopEmptyText"))$("shopEmptyText").textContent=`The library shop could not be read from this BIN: ${e.message||e}`;
    }
    updateSaveState();
  }

  async function loadStageFromDisc(announce=true) {
    if(!state.disc||!state.root)return;
    const stage=inferStageCode();
    const directory=/^(?:R?BO\d|MAR)$/.test(stage)?"BOSS":"ST";
    setStatus(`Extracting ${directory}/${stage}/F_*.BIN from ${state.discName}...`);
    const got=await state.disc.findStageGraphics(stage);
    setStageGraphics(got.bytes,`${state.discName} → ${directory}/${stage}/${C.normalizeIsoName(got.record.name)}`);
    if(announce)setStatus(`Loaded ${got.bytes.length.toLocaleString()} bytes of stage graphics from your disc.`);
  }

  const AREA_NAMES={
    ARE:"Colosseum",CAT:"Catacombs",CEN:"Castle Center",CHI:"Abandoned Mine",
    DAI:"Royal Chapel",DRE:"Nightmare",LIB:"Long Library",MAD:"Debug Room",
    NO0:"Marble Gallery",NO1:"Outer Wall",NO2:"Olrox's Quarters",NO3:"Castle Entrance",
    NO4:"Underground Caverns",NP3:"Castle Entrance",NZ0:"Alchemy Laboratory",NZ1:"Clock Tower",
    ST0:"Prologue",TOP:"Castle Keep",WRP:"Warp Rooms",
    BO0:"Olrox",BO1:"Granfaloon",BO2:"Minotaur and Werewolf",BO3:"Scylla",
    BO4:"Doppelganger 10",BO5:"Hippogryph",BO6:"Richter",BO7:"Cerberus",MAR:"Maria Meeting",
    RBO0:"Trevor, Grant and Sypha",RBO1:"Beelzebub",RBO2:"Death",RBO3:"Medusa",
    RBO4:"Creature",RBO5:"Doppelganger 40",RBO6:"Shaft and Dracula",RBO7:"Akmodan II",RBO8:"Galamoth",
    RARE:"Reverse Colosseum",RCAT:"Floating Catacombs",RCEN:"Reverse Castle Center",
    RCHI:"Cave",RDAI:"Anti-Chapel",RLIB:"Forbidden Library",
    RNO0:"Black Marble Gallery",RNO1:"Reverse Outer Wall",RNO2:"Death Wing's Lair",
    RNO3:"Reverse Castle Entrance",RNO4:"Reverse Caverns",RNZ0:"Necromancy Laboratory",
    RNZ1:"Reverse Clock Tower",RTOP:"Reverse Keep",RWRP:"Reverse Warp Rooms"
  };

  async function selectDiscArea(code) {
    if(!state.disc)return;
    const area=state.areaCatalog.find(a=>a.code===code);
    if(!area)return;
    setCopyTile(false);setCopyCollision(false);
    try {
      setStatus(`Reading ${code} overlay and graphics...`);
      let stage=state.discStages.get(code);
      if(!stage) {
        const bytes=await state.disc.readFile(area.overlay);
        stage=window.SotnStage.parseOverlay(bytes);
        stage.code=code;initPrizeDrops(stage);
        stage.record=area.overlay;stage.code=code;stage.entitiesDirty=false;
        state.discStages.set(code,stage);
      }
      state.discStage=stage;state.root=null;
      state.rooms=stage.rooms;state.layers=stage.layers;state.entityLayouts=stage.entityLayouts;
      state.entitiesDirty=stage.entitiesDirty;
      state.tilemaps.clear();state.tiledefs.clear();
      $("areaName").textContent=`${AREA_NAMES[code]||code} (${code})`;
      const gfx=await state.disc.readFile(area.gfx);
      setStageGraphics(gfx,`${state.discName} / ${area.directory||"ST"}/${code}/F_${code}.BIN`);
      renderRoomList();
      state.room=null;state.roomIndex=-1;
      if(state.rooms.length)await selectRoom(0);
      updateSaveState();
      setStatus(`Loaded ${state.rooms.length} rooms in ${code}.`);
    } catch(e){console.error(e);setStatus(e.message||String(e));alert(e.message||e);}
  }

  async function openStageGraphics() {
    try {
      const {file}=await chooseFile(); const bytes=new Uint8Array(await file.arrayBuffer());
      if(bytes.length<0x8000)throw new Error("This file is too small to be an F_<AREA>.BIN graphics file.");
      setStageGraphics(bytes,file.name);
      setStatus(`Loaded ${file.name} (${bytes.length.toLocaleString()} bytes).`);
    } catch(e){if(e.name!=="AbortError"){console.error(e);alert(e.message||e);}}
  }

  function setStageGraphics(bytes,source) {
    state.stageBytes=bytes; state.stagePages=C.decodeStagePages(bytes); state.stageSource=source;
    state.tileCanvasCache.clear();
    $("gfxStatus").textContent=`Graphics: ${source} • ${state.stagePages.length} pages`;
    $("gfxStatus").classList.add("ok");
    redraw(); redrawPalette();
  }

  function currentEntityBank() {
    if(!state.entityLayouts||!state.room)return null;
    const bi=state.entityLayouts.indices?.[state.room.entityLayoutId];
    return bi===undefined||bi<0?null:(state.entityLayouts.entities?.[bi]||null);
  }
  function activeEntityAreaCode() {
    return String(state.discStage?.code||inferStageCode()||"").toUpperCase();
  }
  function entityCapacity() {
    const bank=currentEntityBank();
    if(!bank||!state.room||!state.discStage)return null;
    return {free:window.SotnStage.entityRepackCapacity(state.discStage)};
  }
  function canAddEntity() {
    return (entityCapacity()?.free||0)>0&&ET.freeSlot(state.discStage)!==null;
  }
  function currentTemplates() {
    const source=state.discStage?.templateSourceRooms?.get(state.roomIndex);
    return ET.templates(state.discStage,state.roomIndex,activeEntityAreaCode(),EC,Number.isInteger(source)?source:null);
  }
  function sourceRoomLabel(stage,index) {
    const room=stage.rooms[index],bankIndex=stage.entityLayouts.indices[room.entityLayoutId];
    const names=[...new Set((stage.originalEntities?.[bankIndex]||[])
      .filter(entity=>entity.x!==-2&&entity.x!==-1&&entity.y!==-2&&entity.y!==-1&&entity.id>0)
      .map(entity=>EC.typeFor(stage.code,entity.id).name))];
    const notable=names.filter(name=>!["Breakable","Room Foreground","Persistent Item Drop","Red Door"].includes(name));
    const summary=(notable.length?notable:names).slice(0,2).join(", ")||"No entities";
    return `Room ${String(index).padStart(2,"0")} · bank ${stage.originalRoomGfxIds[index]} · ${summary}`;
  }
  function incompatibleEntityNames(stage,bankId) {
    const available=new Set();
    for(const [index,room] of stage.rooms.entries()) {
      if(stage.originalRoomGfxIds[index]!==bankId)continue;
      const bankIndex=stage.entityLayouts.indices[room.entityLayoutId];
      for(const entity of stage.originalEntities?.[bankIndex]||[])available.add(entity.id);
    }
    return [...new Set(editableEntities().filter(entity=>!available.has(entity.id))
      .map(entity=>EC.typeFor(stage.code,entity.id).name))];
  }
  function refreshTemplateRoom() {
    const stage=state.discStage,select=$("templateRoom"),hint=$("graphicsBankHint");
    select.replaceChildren();
    if(!stage||!state.room){select.disabled=true;hint.textContent="";return;}
    const current=document.createElement("option");current.value="auto";
    current.textContent=`Current graphics · bank ${stage.originalRoomGfxIds[state.roomIndex]}`;
    select.appendChild(current);
    for(let index=0;index<stage.rooms.length;index++) {
      const option=document.createElement("option");option.value=String(index);
      option.textContent=sourceRoomLabel(stage,index);select.appendChild(option);
    }
    select.disabled=false;
    const source=stage.templateSourceRooms?.get(state.roomIndex);
    select.value=Number.isInteger(source)?String(source):"auto";
    const bankId=state.room.entityGfxId,conflicts=incompatibleEntityNames(stage,bankId);
    hint.textContent=conflicts.length?
      `Bank ${bankId} may not support: ${conflicts.join(", ")}. Check this room in-game.`:
      `Room graphics bank ${bankId}${Number.isInteger(source)?` from room ${source}`:""}.`;
  }
  function templateLabel(choice, variants) {
    return `${choice.type.name}${variants.get(choice.entity.id)>1?` (params ${choice.entity.params}, ${choice.entity.spawnId?"persistent":"respawns"})`:""} · room ${choice.sourceRoomIndex}`;
  }
  function fillTemplateSelect(select, choices) {
    const prior=select.value, variants=new Map();
    for(const choice of choices)variants.set(choice.entity.id,(variants.get(choice.entity.id)||0)+1);
    select.replaceChildren();
    for(const groupName of ["Stage entities","Items"]){
      const groupChoices=choices.filter(choice=>choice.group===groupName);
      if(!groupChoices.length)continue;
      const group=document.createElement("optgroup");group.label=groupName;
      for(const choice of groupChoices){
        const option=document.createElement("option");option.value=choice.key;
        option.textContent=templateLabel(choice,variants);group.appendChild(option);
      }
      select.appendChild(group);
    }
    select.value=choices.some(choice=>choice.key===prior)?prior:(choices[0]?.key||"");
  }
  function editableEntities() {
    const b=currentEntityBank(); if(!b)return[];
    return b.filter(e=>!(e.x===-2&&e.y===-2)&&!(e.x===-1&&e.y===-1));
  }

  function resizeCanvas() {
    const d=activeDims(); if(!d){canvas.width=640;canvas.height=480;return;}
    canvas.width=Math.max(1,Math.floor(d.tilesW*TILE_PX*state.zoom));
    canvas.height=Math.max(1,Math.floor(d.tilesH*TILE_PX*state.zoom));
  }

  function fallbackColor(id,a=1){const h=(id*137.508)%360;return`hsla(${h},35%,${22+(id%5)*5}%,${a})`;}

  function makeTileCanvas(td,tileId,alt) {
    const key=`${td?.name||"none"}|${tileId}|${alt?1:0}`;
    if(state.tileCanvasCache.has(key))return state.tileCanvasCache.get(key);
    if(!state.stageBytes||!state.stagePages||!td)return null;
    const rgba=C.renderTileRGBA(state.stageBytes,state.stagePages,td,tileId,alt);
    if(!rgba)return null;
    const c=document.createElement("canvas");c.width=16;c.height=16;
    c.getContext("2d").putImageData(new ImageData(rgba,16,16),0,0);
    state.tileCanvasCache.set(key,c); return c;
  }

  function drawTileLayer(entry,layer,td,alpha) {
    if(!entry||!layer)return;
    const d=layerDims(layer),s=TILE_PX*state.zoom,alt=!!(layer.flags&CLUT_ALT_FLAG);
    ctx.save();ctx.globalAlpha=alpha;ctx.imageSmoothingEnabled=false;
    for(let y=0;y<d.tilesH;y++)for(let x=0;x<d.tilesW;x++){
      const idx=y*d.tilesW+x;if(idx>=entry.values.length)continue;
      const id=entry.values[idx];if(id===0)continue;
      const tc=makeTileCanvas(td,id,alt);
      if(tc)ctx.drawImage(tc,x*s,y*s,s,s);
      else {ctx.fillStyle=fallbackColor(id);ctx.fillRect(x*s,y*s,s,s);}
    }
    ctx.restore();
  }

  function drawGrid() {
    if(!$("showGrid").checked)return;const d=activeDims();if(!d)return;
    const s=TILE_PX*state.zoom;ctx.save();ctx.strokeStyle="rgba(255,255,255,.12)";ctx.lineWidth=1;
    for(let x=0;x<=d.tilesW;x++){ctx.beginPath();ctx.moveTo(x*s+.5,0);ctx.lineTo(x*s+.5,canvas.height);ctx.stroke();}
    for(let y=0;y<=d.tilesH;y++){ctx.beginPath();ctx.moveTo(0,y*s+.5);ctx.lineTo(canvas.width,y*s+.5);ctx.stroke();}
    ctx.restore();
  }

  function drawEntities() {
    if(!EM.shouldDrawEntities(state.mode,$("showEntities").checked)||!state.room)return;
    const z=state.zoom;ctx.save();
    for(const e of editableEntities()){
      const point=EM.localEntityPoint(e,z),x=point.x,y=point.y,sel=e===state.selectedEntity;
      ctx.beginPath();ctx.arc(x,y,sel?9:7,0,Math.PI*2);ctx.fillStyle=sel?"#ffd45a":"#ff646f";ctx.fill();
      ctx.strokeStyle="#0b0e12";ctx.lineWidth=2;ctx.stroke();
      if(z>=.6){ctx.font="11px sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";ctx.fillStyle="#fff";ctx.fillText(EC.formatId(e.id).split(" / ")[1],x+10,y);}
    }ctx.restore();
  }

  function drawCollision() {
    if(!$("showCollision").checked||!state.room)return;
    const cur=currentPaintLayer($("collisionLayer").value),d=layerDims(cur.layer);
    if(!cur.entry||!cur.td?.collisions||!d)return;
    const s=TILE_PX*state.zoom;
    ctx.save();ctx.fillStyle="rgba(255,67,65,.42)";
    for(let y=0;y<d.tilesH;y++)for(let x=0;x<d.tilesW;x++) {
      const id=cur.entry.values[y*d.tilesW+x];
      if(cur.td.collisions[id])ctx.fillRect(x*s,y*s,s,s);
    }
    ctx.restore();
  }

  function redraw() {
    resizeCanvas();ctx.clearRect(0,0,canvas.width,canvas.height);if(!state.room)return;
    const lr=layerForRoom(state.room);
    if($("showBg").checked)drawTileLayer(state.bgEntry,lr.bg,state.bgTileDef,1);
    if($("showFg").checked)drawTileLayer(state.fgEntry,lr.fg,state.fgTileDef,1);
    drawCollision();drawGrid();drawEntities();$("zoomLabel").textContent=`${Math.round(state.zoom*100)}%`;
    mapBase.width=canvas.width;mapBase.height=canvas.height;
    mapBase.getContext("2d").drawImage(canvas,0,0);
    drawBrushOverlay();
  }

  function drawBrushOverlay() {
    if(!state.room||state.mode!=="tiles")return;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(mapBase,0,0);
    const s=TILE_PX*state.zoom,selection=state.copySelection;
    ctx.save();ctx.imageSmoothingEnabled=false;
    ctx.strokeStyle="#ffd45a";ctx.lineWidth=2;
    if(selection) {
      const bounds=copyBounds(selection);
      ctx.fillStyle="rgba(255,212,90,.2)";
      ctx.fillRect(bounds.x*s,bounds.y*s,bounds.width*s,bounds.height*s);
      ctx.strokeRect(bounds.x*s+1,bounds.y*s+1,bounds.width*s-2,bounds.height*s-2);
    } else if(!state.copyTileActive&&state.tileBrush&&state.brushHover) {
      const cur=currentPaintLayer(),d=layerDims(cur.layer),brush=state.tileBrush;
      if(d&&cur.td===brush.td) {
        const {x,y}=state.brushHover;
        const width=Math.min(brush.width,d.tilesW-x),height=Math.min(brush.height,d.tilesH-y);
        ctx.globalAlpha=.65;
        for(let row=0;row<height;row++)for(let col=0;col<width;col++) {
          if((y+row)*d.tilesW+x+col>=cur.entry.values.length)continue;
          const id=brush.values[row*brush.width+col];
          const tc=id?makeTileCanvas(cur.td,id,!!(cur.layer.flags&CLUT_ALT_FLAG)):null;
          if(tc)ctx.drawImage(tc,(x+col)*s,(y+row)*s,s,s);
          else {ctx.fillStyle=id?fallbackColor(id):"#111720";ctx.fillRect((x+col)*s,(y+row)*s,s,s);}
        }
        ctx.globalAlpha=1;
        ctx.strokeRect(x*s+1,y*s+1,width*s-2,height*s-2);
      }
    }
    ctx.restore();
  }

  function currentPaintLayer(which=$("paintLayer").value) {
    const lr=layerForRoom(state.room||{layerId:-1});
    return which==="fg"
      ? {entry:state.fgEntry,layer:lr.fg,td:state.fgTileDef}
      : {entry:state.bgEntry,layer:lr.bg,td:state.bgTileDef};
  }

  function redrawPalette() {
    const cur=currentPaintLayer(),td=cur.td;
    if(!td){paletteCanvas.width=256;paletteCanvas.height=128;pctx.clearRect(0,0,256,128);return;}
    const count=Math.min(td.tiles.length,td.pages.length,td.cluts.length,4096),cell=32,cols=8;
    paletteCanvas.width=cols*cell;paletteCanvas.height=Math.ceil(count/cols)*cell;
    pctx.clearRect(0,0,paletteCanvas.width,paletteCanvas.height);pctx.imageSmoothingEnabled=false;
    const alt=!!(cur.layer?.flags&CLUT_ALT_FLAG);
    const selected=Number($("tileId").value)||0;
    for(let id=0;id<count;id++){
      const x=(id%cols)*cell,y=Math.floor(id/cols)*cell,tc=makeTileCanvas(td,id,alt);
      if(tc)pctx.drawImage(tc,x,y,cell,cell);
      else {pctx.fillStyle=fallbackColor(id);pctx.fillRect(x,y,cell,cell);}
      if(id===selected){pctx.strokeStyle="#ffd45a";pctx.lineWidth=3;pctx.strokeRect(x+1.5,y+1.5,cell-3,cell-3);}
    }
    updateTileInfo();
  }

  function updateTileInfo(){
    if(state.tileBrush){$("tileInfo").textContent=`Copied brush: ${state.tileBrush.width} × ${state.tileBrush.height} tiles`;return;}
    const cur=currentPaintLayer(),td=cur.td,id=Number($("tileId").value)||0;
    if(!td||id>=td.tiles.length){$("tileInfo").textContent="No tile definition.";return;}
    $("tileInfo").textContent=`cell 0x${td.tiles[id].toString(16).padStart(2,"0")} • page ${td.pages[id]} • CLUT 0x${td.cluts[id].toString(16).padStart(2,"0")}`;
  }

  paletteCanvas.addEventListener("mousedown",e=>{
    const r=paletteCanvas.getBoundingClientRect(),sx=paletteCanvas.width/r.width,sy=paletteCanvas.height/r.height;
    const x=(e.clientX-r.left)*sx,y=(e.clientY-r.top)*sy,cell=32,cols=8;
    const id=Math.floor(y/cell)*cols+Math.floor(x/cell);
    state.tileBrush=null;$("tileId").value=id;redrawPalette();redraw();
  });

  function mousePos(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function tileAt(pos,which=$("paintLayer").value) {
    const cur=currentPaintLayer(which);if(!cur.entry||!cur.layer)return null;
    const d=layerDims(cur.layer),s=TILE_PX*state.zoom,x=Math.floor(pos.x/s),y=Math.floor(pos.y/s);
    if(x<0||y<0||x>=d.tilesW||y>=d.tilesH||y*d.tilesW+x>=cur.entry.values.length)return null;
    return {...cur,which,x,y,idx:y*d.tilesW+x};
  }
  function setCopyTile(active) {
    finishPainting();state.copySelection=null;
    state.copyTileActive=active;
    $("copyTile").classList.toggle("active",active);
    $("copyTile").setAttribute("aria-pressed",String(active));
    canvas.classList.toggle("copying",active||state.copyCollisionActive);
    drawBrushOverlay();
  }
  function setCopyCollision(active) {
    state.copyCollisionActive=active;
    $("copyCollision").classList.toggle("active",active);
    $("copyCollision").setAttribute("aria-pressed",String(active));
    canvas.classList.toggle("copying",active||state.copyTileActive);
  }
  function updateCollisionAvailability() {
    const cur=currentPaintLayer($("collisionLayer").value);
    $("copyCollision").disabled=!cur.entry||!cur.td?.collisions;
    if($("copyCollision").disabled)setCopyCollision(false);
  }
  function copyCollisionAt(pos) {
    const t=tileAt(pos,$("collisionLayer").value);
    if(!t?.td?.collisions)return;
    const id=t.entry.values[t.idx];
    if(id>=t.td.collisions.length)return;
    const value=t.td.collisions[id];
    $("collisionId").value=value;
    setCopyCollision(false);
    setStatus(`Copied collision ${value} from tile ${id}.`);
  }
  function startTileCopy(pos) {
    const fg=$("showFg").checked?tileAt(pos,"fg"):null;
    const bg=$("showBg").checked?tileAt(pos,"bg"):null;
    const t=[fg,bg].find(hit=>hit&&hit.entry.values[hit.idx]!==0)||tileAt(pos);
    if(!t)return;
    state.copySelection={...t,endX:t.x,endY:t.y};
    state.brushHover=null;drawBrushOverlay();
  }
  function moveTileCopy(pos) {
    const selection=state.copySelection;if(!selection)return;
    const d=layerDims(selection.layer),s=TILE_PX*state.zoom;
    selection.endX=Math.max(0,Math.min(d.tilesW-1,Math.floor(pos.x/s)));
    selection.endY=Math.max(0,Math.min(d.tilesH-1,Math.floor(pos.y/s)));
    drawBrushOverlay();
  }
  function copyBounds(selection) {
    return {x:Math.min(selection.x,selection.endX),y:Math.min(selection.y,selection.endY),
      width:Math.abs(selection.x-selection.endX)+1,height:Math.abs(selection.y-selection.endY)+1};
  }
  function finishTileCopy() {
    const selection=state.copySelection;if(!selection)return;
    const bounds=copyBounds(selection),d=layerDims(selection.layer);
    const values=new Uint16Array(bounds.width*bounds.height);
    for(let y=0;y<bounds.height;y++)for(let x=0;x<bounds.width;x++) {
      const idx=(bounds.y+y)*d.tilesW+bounds.x+x;
      if(idx>=selection.entry.values.length){state.copySelection=null;drawBrushOverlay();return;}
      values[y*bounds.width+x]=selection.entry.values[idx];
    }
    state.tileBrush={width:bounds.width,height:bounds.height,values,td:selection.td};
    $("paintLayer").value=selection.which;$("tileId").value=values[0];
    state.brushHover={x:selection.endX,y:selection.endY};
    setCopyTile(false);redrawPalette();
    setStatus(`Copied ${bounds.width} × ${bounds.height} tiles from ${selection.which==="fg"?"foreground":"background"}. Click or drag to paint.`);
  }
  function entityAt(pos) {
    if(!state.room)return null;let best=null,bestD=144;
    for(const e of editableEntities()){const point=EM.localEntityPoint(e,state.zoom),dx=point.x-pos.x,dy=point.y-pos.y,d=dx*dx+dy*dy;if(d<bestD){bestD=d;best=e;}}
    return best;
  }
  function paintAt(pos) {
    const t=tileAt(pos);if(!t)return;
    const brush=state.tileBrush,d=layerDims(t.layer),stroke=state.paintStroke;
    if(brush&&brush.td!==t.td)return;
    let changed=false;
    for(let y=0;y<(brush?.height||1);y++)for(let x=0;x<(brush?.width||1);x++) {
      if(t.x+x>=d.tilesW||t.y+y>=d.tilesH)continue;
      const idx=(t.y+y)*d.tilesW+t.x+x;
      if(idx>=t.entry.values.length)continue;
      const value=brush?brush.values[y*brush.width+x]:Number($("tileId").value)&0xffff;
      const old=t.entry.values[idx];if(old===value)continue;
      if(stroke) {
        if(!stroke.changes.has(t.entry))stroke.changes.set(t.entry,new Map());
        if(!stroke.dirty.has(t.entry))stroke.dirty.set(t.entry,t.entry.dirty);
        if(!stroke.changes.get(t.entry).has(idx))stroke.changes.get(t.entry).set(idx,old);
      }
      t.entry.values[idx]=value;changed=true;
    }
    if(changed){t.entry.dirty=true;markDirty("tiles");redraw();}
  }
  function finishPainting() {
    state.painting=false;
    const stroke=state.paintStroke;state.paintStroke=null;
    if(!stroke)return;
    for(const [entry,changes] of stroke.changes) {
      for(const [idx,old] of changes)if(entry.values[idx]===old)changes.delete(idx);
      if(!changes.size)entry.dirty=stroke.dirty.get(entry);
    }
    const changed=[...stroke.changes.values()].some(changes=>changes.size);
    if(changed)pushUndo("tile painting",()=>{
      for(const [entry,changes] of stroke.changes) {
        for(const [idx,old] of changes)entry.values[idx]=old;
        entry.dirty=stroke.dirty.get(entry);
      }
    });
    else updateSaveState();
  }
  function finishEntityDrag() {
    state.draggingEntity=false;
    const drag=state.entityDrag;state.entityDrag=null;
    if(!drag)return;
    if(drag.entity.x===drag.x&&drag.entity.y===drag.y) {
      restoreEntityEditState(drag.previous);updateSaveState();return;
    }
    pushUndo("entity move",()=>{
      drag.entity.x=drag.x;drag.entity.y=drag.y;restoreEntityEditState(drag.previous);
    });
  }
  function paintCollisionAt(pos) {
    const t=tileAt(pos,$("collisionLayer").value);if(!t||!t.td?.collisions)return;
    const id=t.entry.values[t.idx],value=Number($("collisionId").value);
    if(!Number.isInteger(value)||value<0||value>255)return;
    if(id>=t.td.collisions.length)return;
    const old=t.td.collisions[id];if(old===value)return;
    const wasDirty=t.td.dirty;
    t.td.collisions[id]=value;t.td.dirty=true;
    pushUndo("collision edit",()=>{t.td.collisions[id]=old;t.td.dirty=wasDirty;});
    markDirty("collision");redraw();
    setStatus(`Tile ${id} collision set to ${value} across this tile definition.`);
  }

  const canvasWrap=$("canvasWrap");
  canvasWrap.addEventListener("contextmenu",e=>e.preventDefault());
  canvasWrap.addEventListener("mousedown",e=>{
    if(e.button!==2||!state.room)return;
    state.pan={x:e.clientX,y:e.clientY,left:canvasWrap.scrollLeft,top:canvasWrap.scrollTop};
    canvasWrap.classList.add("panning");
    e.preventDefault();
  });
  canvas.addEventListener("mousedown",e=>{
    if(e.button===2)return;
    if(!state.room)return;const p=mousePos(e);
    if(state.copyTileActive){if(e.button===0)startTileCopy(p);return;}
    if(state.copyCollisionActive){if(e.button===0)copyCollisionAt(p);return;}
    if(state.mode==="entities"){
      state.selectedEntity=entityAt(p);state.draggingEntity=!!state.selectedEntity&&e.button===0;
      state.entityDrag=state.draggingEntity?{entity:state.selectedEntity,x:state.selectedEntity.x,y:state.selectedEntity.y,previous:entityEditState()}:null;
      refreshEntityFields();redraw();return;
    }
    if(state.mode==="collision") {if(e.button===0)paintCollisionAt(p);return;}
    if(e.button===0){
      const t=tileAt(p);state.brushHover=t?{x:t.x,y:t.y}:null;
      state.painting=true;state.paintStroke={changes:new Map(),dirty:new Map()};paintAt(p);
    }
  });
  window.addEventListener("mousemove",e=>{
    if(state.copySelection){moveTileCopy(mousePos(e));return;}
    if(!state.pan)return;
    canvasWrap.scrollLeft=state.pan.left+state.pan.x-e.clientX;
    canvasWrap.scrollTop=state.pan.top+state.pan.y-e.clientY;
  });
  canvas.addEventListener("mousemove",e=>{
    const p=mousePos(e);
    if(state.copySelection){moveTileCopy(p);return;}
    if(state.mode==="tiles") {
      const t=tileAt(p);state.brushHover=t?{x:t.x,y:t.y}:null;
      if(state.tileBrush)drawBrushOverlay();
    }
    if(state.mode==="entities"&&state.draggingEntity&&state.selectedEntity){
      const local=EM.localPositionAtCanvasPoint(p,state.zoom);
      state.selectedEntity.x=local.x;state.selectedEntity.y=local.y;
      $("entityX").value=local.x;$("entityY").value=local.y;
      renderEntityList();markDirty("entities");redraw();
    } else if(state.mode==="tiles"&&state.painting){paintAt(p);}
  });
  canvas.addEventListener("mouseleave",()=>{state.brushHover=null;drawBrushOverlay();});
  window.addEventListener("mouseup",e=>{
    if(e?.button!==undefined&&e.button!==0&&state.copySelection){state.pan=null;canvasWrap.classList.remove("panning");return;}
    if(state.copySelection&&Number.isFinite(e?.clientX)&&Number.isFinite(e?.clientY))moveTileCopy(mousePos(e));
    finishTileCopy();state.pan=null;canvasWrap.classList.remove("panning");finishPainting();finishEntityDrag();
  });
  window.addEventListener("blur",()=>{
    state.copySelection=null;state.brushHover=null;drawBrushOverlay();
    state.pan=null;canvasWrap.classList.remove("panning");finishPainting();finishEntityDrag();
  });

  function renderEntityList(){
    const list=$("entityList"),scrollTop=list.scrollTop,areaCode=activeEntityAreaCode(),entities=editableEntities();
    list.replaceChildren();
    $("entityCount").textContent=`${entities.length} entities`;
    $("entityRoomTitle").textContent=state.room?`Room ${state.roomIndex}`:"No room selected";
    for(const [index,entity] of entities.entries()){
      const type=EC.typeFor(areaCode,entity.id),button=document.createElement("button");
      button.type="button";button.className="entityRow";button.classList.toggle("active",entity===state.selectedEntity);
      button.setAttribute("aria-pressed",String(entity===state.selectedEntity));
      const held=heldLabel(entity,type.symbol);
      button.textContent=`${String(index+1).padStart(2,"0")} ${type.label}${held?` → ${held}`:""} · ${entity.x}, ${entity.y}`;
      button.title=type.symbol||type.name;
      button.onclick=()=>{state.selectedEntity=entity;refreshEntityFields();redraw();};
      list.appendChild(button);
    }
    if(entities.length===0){const empty=document.createElement("div");empty.className="muted";empty.textContent="No entities in this room.";list.appendChild(empty);}
    list.scrollTop=scrollTop;
  }
  function selectedTemplate() {
    return currentTemplates().find(choice=>choice.key===$("entityType").value)||null;
  }
  function populateEntityTypes(entity){
    const select=$("entityType"),choices=currentTemplates();
    fillTemplateSelect(select,choices);
    const matched=choices.find(choice=>choice.entity.id===entity.id&&choice.entity.flags===entity.flags&&choice.entity.params===entity.params&&!!choice.entity.spawnId===!!entity.spawnId);
    if(matched)select.value=matched.key;
    else {
      const option=document.createElement("option");option.value="current";
      option.textContent=`Current: ${EC.typeFor(activeEntityAreaCode(),entity.id).label}`;
      select.appendChild(option);select.value="current";
    }
  }
  // How an entity's Params picks what it gives. Persistent drops, and urns,
  // jugs and busts in some stages, use a PrizeDrops slot; other breakables
  // (candles, lamps, braziers) hold an ITEMDROP ID in Params & 0xFFF; a
  // subweapon container picks one of nine subweapons. Globe tables, relic
  // containers and blue flame tables (NZ0/RNZ0) use a prize slot directly or
  // through a lookup table, and NZ0's relic container can hold a relic.
  function dropRule(code,e,stage=state.discStage){
    if(!e||e.x===-2||e.x===-1)return null;
    return window.SotnStage.dropRule?.(code,EC.typeFor(code,e.id).symbol,e.params,stage)??null;
  }
  const containerName=symbol=>({E_GLOBE_TABLE:"globe table",E_RELIC_CONTAINER:"relic container",E_BLUE_FLAME_TABLE:"blue flame table"})[symbol];
  // Placements whose Params reach the same lookup entry or prize slot.
  function lookupUsers(code,rule){
    return (state.discStage?.entityLayouts?.entities||[]).flat().filter(e=>{const r=dropRule(code,e);return r?.lookup&&r.lookup.offset===rule.lookup.offset&&r.lookup.index===rule.lookup.index;});
  }
  const lookName=look=>window.SotnStatsCatalog?.BREAKABLE_LOOKS?.[look]?.toLowerCase()||"breakable";
  // PrizeDrops[] length is taken from the room layouts: the highest slot any
  // persistent drop (or slot-using breakable) uses. Entries past it may belong to other stage data.
  function initPrizeDrops(stage){
    stage.prizeDrops=null;
    stage.subweaponTable=window.SotnStage.findSubweaponTable?.(stage.bytes)??null;
    const ids=Object.fromEntries((EC.areaTypes(stage.code)||[]).map(t=>[t.symbol,t.id]));
    window.SotnStage.initContainerDrops?.(stage,ids);
    if(!(stage.prizeTableOffset>=0))return;
    let max=-1;
    for(const bank of stage.originalEntities||[])for(const e of bank){const rule=dropRule(stage.code,e,stage);if(rule?.kind==="slot")max=Math.max(max,rule.slot);}
    const length=window.SotnStage.prizeTableLength(stage,max),off=stage.prizeTableOffset;
    if(length<1||off+length*2>stage.bytes.length)return;
    const original=new Uint16Array(length);
    for(let i=0;i<length;i++)original[i]=stage.bytes[off+i*2]|stage.bytes[off+i*2+1]<<8;
    stage.prizeDrops={offset:off,original,values:original.slice()};
  }
  function dropGroups(){
    if(state.statsModel)return window.SotnStatsModel.dropChoices(state.statsModel);
    const code=activeEntityAreaCode(),groups=new Map();
    for(const c of [...(EC.getParamItemChoices(code,"E_PRIZE_DROP")||[]),...(EC.getParamItemChoices(code,"E_EQUIP_ITEM_DROP")||[])]){
      if(!groups.has(c.group))groups.set(c.group,[]);
      groups.get(c.group).push({value:c.globalId,label:`${EC.displayName(c.symbol)} (${EC.formatId(c.globalId).split(" / ")[0]})`});
    }
    return [...groups].map(([group,items])=>({group,items}));
  }
  function relicList(){
    if(state.statsModel)return window.SotnStatsModel.relicChoices(state.statsModel);
    return (window.SotnStatsCatalog?.RELICS||[]).map((name,value)=>({value,label:`${name} (#${value})`}));
  }
  const withoutId=label=>label.replace(/ \([^)]*\)$/,"");
  function dropName(value){
    for(const g of dropGroups())for(const it of g.items)if(it.value===value)return withoutId(it.label);
    return EC.formatId(value);
  }
  function subweaponChoices(){
    const table=state.discStage?.subweaponTable||window.SotnStatsCatalog?.SUBWEAPON_CONTAINER||[];
    return table.map((drop,index)=>({value:index,label:`${dropName(drop)} (${index})`}));
  }
  function heldLabel(entity,symbol){
    const rule=dropRule(activeEntityAreaCode(),entity),table=state.discStage?.prizeDrops;
    if(rule?.kind==="slot"||rule?.kind==="fixed")return table&&rule.slot<table.values.length?dropName(table.values[rule.slot]):null;
    if(rule?.kind==="direct")return dropName(rule.value);
    if(rule?.kind==="subweapon")return withoutId(subweaponChoices()[rule.index]?.label||"")||null;
    if(rule?.kind==="relic"){
      const relic=relicList().find(r=>r.value===(rule.relic&0x7FFF));
      return relic?withoutId(relic.label):null;
    }
    if(symbol==="E_RELIC_ORB"){
      const relic=relicList().find(r=>r.value===(entity.params&0x7FFF));
      return relic?withoutId(relic.label):null;
    }
    return null;
  }
  function fillSelect(select,groups,value){
    select.replaceChildren();
    let found=false;
    for(const g of groups){
      const og=document.createElement("optgroup");og.label=g.group;
      for(const it of g.items){const o=document.createElement("option");o.value=String(it.value);o.textContent=it.label;og.appendChild(o);if(it.value===value)found=true;}
      select.appendChild(og);
    }
    if(!found){const o=document.createElement("option");o.value=String(value);o.textContent=`${EC.formatId(value)} (current, unlisted)`;select.appendChild(o);}
    select.value=String(value);
  }
  function formEntity(){
    const id=selectedTemplate()?.entity.id??state.selectedEntity?.id??0;
    return {id,x:0,y:0,params:Number($("entityParams").value)||0};
  }
  function refreshHeldItem(){
    const wrap=$("heldItemWrap"),select=$("entityHeldItem"),hint=$("heldItemHint");
    const code=activeEntityAreaCode(),rule=dropRule(code,formEntity());
    const show=rule?.kind==="slot"||rule?.kind==="fixed";
    wrap.classList.toggle("hidden",!show);
    const slotWrap=$("heldSlotWrap"),slotSelect=$("entityPrizeSlot");
    slotWrap.classList.toggle("hidden",!show||rule.kind!=="slot"||!!rule.lookup);
    if(!show)return;
    const stage=state.discStage,table=stage?.prizeDrops,slot=rule.slot;
    slotSelect.replaceChildren();slotSelect.disabled=!table;
    if(table&&rule.kind==="slot"&&!rule.lookup){
      if(!Number.isInteger(slot)||slot<0||slot>=table.values.length){
        const option=document.createElement("option");option.value="";
        option.textContent="Choose a valid item slot";slotSelect.appendChild(option);
      }
      for(let i=0;i<table.values.length;i++){
        const option=document.createElement("option");option.value=String(i);
        option.textContent=`${i} — ${dropName(table.values[i])}`;slotSelect.appendChild(option);
      }
      slotSelect.value=slot>=0&&slot<table.values.length?String(slot):"";
    }
    select.disabled=true;
    if(rule.kind==="fixed"){
      if(table&&slot<table.values.length)fillSelect(select,dropGroups(),table.values[slot]);else select.replaceChildren();
      hint.textContent=`This ${lookName(rule.look)} always gives prize slot ${slot}; the slot is set in ${code}'s code, so it is not changed here.`;
      return;
    }
    if(!table){select.replaceChildren();hint.textContent=stage?"This stage's prize table was not found, so the held item cannot be changed here.":"Open a BIN to choose what this pickup holds.";return;}
    if(!Number.isInteger(slot)||slot<0||slot>=table.values.length){
      select.replaceChildren();
      hint.textContent=`Slot ${slot} is outside this stage's prize table (slots 0-${table.values.length-1}). `+
        (rule.lookup?"Set Params to a valid lookup entry.":"Choose a valid Item slot above, then choose Holds item and press Apply Changes.");
      return;
    }
    select.disabled=false;
    fillSelect(select,dropGroups(),table.values[slot]);
    const users=(stage.entityLayouts?.entities||[]).flat().filter(e=>{const r=dropRule(code,e);return r?.kind==="slot"&&r.slot===slot;}).length;
    hint.textContent=(rule.symbol==="E_BREAKABLE"?`This ${lookName(rule.look)} spawns a pickup from prize table slot ${slot} (Params & 0x1FF). `:"")+
      (rule.lookup?`This ${containerName(rule.symbol)} spawns a pickup from prize table slot ${slot}, read from entry ${rule.lookup.index} (its Params) of ${code}'s lookup table at 0x${rule.lookup.offset.toString(16).toUpperCase()}. `:
        containerName(rule.symbol)?`This ${containerName(rule.symbol)} spawns a pickup from prize table slot ${slot} (its Params). `:"")+
      `Prize table slot ${slot} of ${table.values.length}. `+(users>1?
      `${users} placements in this stage use this slot (often one pickup in two room layouts). They hold the same item, and collecting one removes the others.`:
      "Breakable walls and scripted objects can also spawn a slot. Press Apply Changes to save.");
  }
  $("entityPrizeSlot").onchange=()=>{
    const rule=dropRule(activeEntityAreaCode(),formEntity()),table=state.discStage?.prizeDrops;
    const chosen=$("entityPrizeSlot").value,slot=Number(chosen);
    if(chosen===""||rule?.kind!=="slot"||rule.lookup||!table||!Number.isInteger(slot)||slot<0||slot>=table.values.length)return;
    const params=Number($("entityParams").value)||0;
    $("entityParams").value=rule.symbol==="E_BREAKABLE"?(params&0xFE00)|slot:slot;
    refreshParamChoices();
  };
  function refreshRelicChoice(symbol){
    const wrap=$("relicChoiceWrap"),select=$("entityRelic"),code=activeEntityAreaCode(),rule=dropRule(code,formEntity());
    wrap.classList.toggle("hidden",symbol!=="E_RELIC_ORB"&&rule?.kind!=="relic");
    if(rule?.kind==="relic"){
      const users=lookupUsers(code,rule).length,from=state.discStage.containerDrops.rules[rule.symbol].relicFrom;
      fillSelect(select,[{group:"Relics",items:relicList()}],rule.relic&0x7FFF);
      $("relicHint").textContent=`This relic container breaks into a Relic Orb because its Params is ${from} or more. The relic is entry ${rule.lookup.index} of ${code}'s lookup table at 0x${rule.lookup.offset.toString(16).toUpperCase()}`+
        (users>1?`, which ${users} placements in this stage share (often one container in two room layouts).`:".")+
        " Place each relic once: an orb for a relic you already own disappears. Press Apply Changes to save.";
      return;
    }
    if(symbol!=="E_RELIC_ORB")return;
    const params=Number($("entityParams").value)||0;
    fillSelect(select,[{group:"Relics",items:relicList()}],params&0x7FFF);
    $("relicHint").textContent="Place each relic once: an orb for a relic you already own disappears, and a relic no orb holds cannot be obtained.";
  }
  $("entityRelic").onchange=()=>{
    if(dropRule(activeEntityAreaCode(),formEntity())?.kind==="relic")return;
    const params=Number($("entityParams").value)||0;
    $("entityParams").value=(params&0x8000)|Number($("entityRelic").value);
    refreshParamChoices();
  };

  function refreshDropChoice(){
    const wrap=$("dropChoiceWrap"),select=$("entityDrop"),hint=$("dropHint");
    const rule=dropRule(activeEntityAreaCode(),formEntity());
    const show=rule?.kind==="direct"||rule?.kind==="subweapon";
    wrap.classList.toggle("hidden",!show);
    if(!show)return;
    if(rule.kind==="subweapon"){
      $("dropChoiceLabel").textContent="Holds subweapon";
      fillSelect(select,[{group:"Subweapons",items:subweaponChoices()}],rule.index);
      hint.textContent=state.discStage?.subweaponTable?"Read from this stage's subweapon container table. Params also tints the container.":
        "This stage's subweapon table was not found; names follow the vanilla order.";
      return;
    }
    const looks=window.SotnStatsCatalog?.BREAKABLE_LOOKS||{};
    $("dropChoiceLabel").textContent="Drops";
    fillSelect(select,dropGroups(),rule.value);
    hint.textContent=`Params & 0xFFF is the item; Params >> 12 (${rule.look}) is the look${looks[rule.look]?`, a ${lookName(rule.look)}`:""}. `+
      (String(activeEntityAreaCode()).toUpperCase()==="ST0"?"":"Breakables drop items only once Alucard has the Cube of Zoe. ")+"Press Apply Changes to save.";
  }
  $("entityDrop").onchange=()=>{
    const rule=dropRule(activeEntityAreaCode(),formEntity()),value=Number($("entityDrop").value),params=Number($("entityParams").value)||0;
    if(!rule||!Number.isInteger(value))return;
    $("entityParams").value=rule.kind==="subweapon"?value:(params&0xF000)|(value&0xFFF);
    refreshParamChoices();
  };
  // Equipment and prize drop choices use the loaded BIN's item names when stats were read.
  function binItemChoices(symbol){
    if(!state.statsModel||(symbol!=="E_PRIZE_DROP"&&symbol!=="E_EQUIP_ITEM_DROP"))return null;
    const equip=symbol==="E_EQUIP_ITEM_DROP",out=[];
    for(const g of dropGroups())for(const it of g.items){
      if(equip!==(it.value>=0x80))continue;
      out.push({param:equip?it.value-0x80:it.value,label:it.label,group:g.group});
    }
    return out;
  }
  function refreshParamChoices(){
    const code=activeEntityAreaCode(),id=selectedTemplate()?.entity.id??state.selectedEntity?.id??0,type=EC.typeFor(code,id);
    const choices=binItemChoices(type.symbol)||EC.getParamItemChoices(code,type.symbol),select=$("entityItemChoice"),wrap=$("itemChoiceWrap");
    $("entityParamsHint").textContent=EC.paramHint(type.symbol);
    refreshHeldItem();refreshRelicChoice(type.symbol);refreshDropChoice();
    wrap.classList.toggle("hidden",choices===null);
    if(choices===null)return;
    select.replaceChildren();
    const groups=new Map();
    for(const choice of choices){
      if(!groups.has(choice.group))groups.set(choice.group,[]);
      groups.get(choice.group).push(choice);
    }
    for(const [label,items] of groups){
      const group=document.createElement("optgroup");group.label=label;
      for(const item of items){const option=document.createElement("option");option.value=String(item.param);option.textContent=item.label;group.appendChild(option);}
      select.appendChild(group);
    }
    const rawValue=Number($("entityParams").value);
    if(Number.isInteger(rawValue)&&rawValue>=0&&rawValue<=65535&&!choices.some(choice=>choice.param===rawValue)){
      const group=document.createElement("optgroup");group.label="Current value";
      const option=document.createElement("option");option.value=String(rawValue);
      option.textContent=`Unlisted value (${EC.formatId(rawValue)}; retained as entered)`;
      group.appendChild(option);select.appendChild(group);
    }
    select.value=String(rawValue);
  }
  function refreshEntityCapacity(){
    const bank=currentEntityBank(),capacity=entityCapacity(),selected=state.selectedEntity,choices=currentTemplates();
    fillTemplateSelect($("newEntityType"),choices);
    $("newEntityType").disabled=choices.length===0;
    $("addEntity").disabled=!canAddEntity()||choices.length===0;
    $("duplicateEntity").disabled=!selected||!canAddEntity();
    $("deleteEntity").disabled=!selected||!bank||!bank.includes(selected);
    if(!state.room){$("entityCapacityHint").textContent="Choose a room to inspect its layout slots.";}
    else if(!bank){$("entityCapacityHint").textContent="No entity layout is linked to this room.";}
    else if(!state.discStage){$("entityCapacityHint").textContent="Free space is not verified for this asset folder; Add is disabled.";}
    else if(!capacity||capacity.free===0){$("entityCapacityHint").textContent="No safe space remains in this stage's entity banks.";}
    else if(ET.freeSlot(state.discStage)===null){$("entityCapacityHint").textContent="No free stage entity slot remains.";}
    else if(choices.length===0){$("entityCapacityHint").textContent="No working templates use this room's graphics bank.";}
    else{$("entityCapacityHint").textContent=`Room-compatible templates: ${choices.length}. Space for about ${capacity.free} more entries.`;}
  }
  function refreshEntityFields(){
    const entity=state.selectedEntity,areaCode=activeEntityAreaCode();
    $("entityAreaCode").textContent=areaCode;
    $("entityEmpty").classList.toggle("hidden",!!entity);
    $("entityFields").classList.toggle("hidden",!entity);
    refreshTemplateRoom();renderEntityList();refreshEntityCapacity();
    if(!entity)return;
    populateEntityTypes(entity);
    $("entityX").value=entity.x??0;$("entityY").value=entity.y??0;
    $("entityFlags").value=entity.flags??0;$("entitySlot").value=entity.slot??0;
    $("entitySpawn").value=entity.spawnId??0;$("entityParams").value=entity.params??0;
    refreshParamChoices();
  }
  $("templateRoom").onchange=()=>{
    const stage=state.discStage,index=state.roomIndex;
    if(!stage||index<0)return;
    const value=$("templateRoom").value;
    const source=value==="auto"?null:Number(value);
    if(source!==null&&(!Number.isInteger(source)||source<0||source>=stage.rooms.length))return;
    const priorSource=stage.templateSourceRooms?.get(index)??null;
    const priorBank=stage.rooms[index].entityGfxId;
    const nextBank=stage.originalRoomGfxIds[source??index];
    if(priorSource===source&&priorBank===nextBank)return;
    stage.templateSourceRooms??=new Map();
    if(source===null)stage.templateSourceRooms.delete(index);
    else stage.templateSourceRooms.set(index,source);
    stage.rooms[index].entityGfxId=nextBank;
    pushUndo("room graphics and templates",()=>{
      stage.rooms[index].entityGfxId=priorBank;
      if(priorSource===null)stage.templateSourceRooms.delete(index);
      else stage.templateSourceRooms.set(index,priorSource);
    });
    refreshEntityFields();updateSaveState();
    setStatus(source===null?`Room ${index} uses its original graphics.`:
      `Room ${index} now uses graphics and entity templates from room ${source}.`);
  };
  $("entityType").onchange=()=>{
    const choice=selectedTemplate(),entity=state.selectedEntity;
    if(choice&&entity){
      const next=ET.changeType(state.discStage,entity,choice);
      if(!next){setStatus("No free persistence index for that template.");return;}
      $("entityFlags").value=next.flags;$("entitySpawn").value=next.spawnId;$("entityParams").value=next.params;
    }
    refreshParamChoices();
  };
  $("entityParams").oninput=refreshParamChoices;
  $("entityItemChoice").onchange=()=>{$("entityParams").value=$("entityItemChoice").value;};
  $("applyEntity").onclick=()=>{
    const entity=state.selectedEntity;if(!entity)return;
    const template=selectedTemplate();
    const changed=template?ET.changeType(state.discStage,entity,template):{...entity};
    if(!changed){setStatus("No free persistence index for that template.");return;}
    const next={
      id:changed.id,
      x:Number($("entityX").value),
      y:Number($("entityY").value),
      flags:Number($("entityFlags").value),
      slot:Number($("entitySlot").value),
      spawnId:Number($("entitySpawn").value),
      params:Number($("entityParams").value)
    };
    if(Object.values(next).some(value=>!Number.isInteger(value))||next.id<0||next.id>255||
      next.x< -32768||next.x>32767||next.y< -32768||next.y>32767||
      next.flags<0||next.flags>255||next.slot<0||next.slot>255||next.spawnId<0||next.spawnId>255||
      next.params<0||next.params>65535){setStatus("Enter values within each entity field's valid range.");return;}
    const before={...entity},previous=entityEditState();
    const table=state.discStage?.prizeDrops,held=$("entityHeldItem");
    let prize=null;
    const rule=dropRule(activeEntityAreaCode(),next);
    if(table&&["slot","fixed"].includes(rule?.kind)&&rule.slot>=table.values.length) {
      setStatus(`Choose a prize slot from 0 to ${table.values.length-1}.`);return;
    }
    if(table&&!held.disabled&&!$("heldItemWrap").classList.contains("hidden")&&rule?.kind==="slot"&&rule.slot<table.values.length) {
      const value=Number(held.value);
      if(Number.isInteger(value)&&value>=0&&value<=0xFFFF&&value!==table.values[rule.slot])prize={slot:rule.slot,before:table.values[rule.slot],value};
    }
    let relic=null;
    const lookup=rule?.kind==="relic"&&state.discStage?.containerDrops?.tables.get(rule.lookup.offset);
    if(lookup&&!$("relicChoiceWrap").classList.contains("hidden")) {
      const value=(lookup.values[rule.lookup.index]&0x8000)|Number($("entityRelic").value);
      if(Number.isInteger(value)&&value>=0&&value<=0xFFFF&&value!==lookup.values[rule.lookup.index])relic={table:lookup,index:rule.lookup.index,before:lookup.values[rule.lookup.index],value};
    }
    const same=Object.keys(next).every(key=>String(entity[key])===String(next[key]));
    if(same&&!prize&&!relic)return;
    if(!same)Object.assign(entity,next);
    if(prize)table.values[prize.slot]=prize.value;
    if(relic)relic.table.values[relic.index]=relic.value;
    pushUndo(same?(relic?"held relic":"held item"):"entity properties",()=>{
      if(!same){Object.assign(entity,before);restoreEntityEditState(previous);}
      if(prize)table.values[prize.slot]=prize.before;
      if(relic)relic.table.values[relic.index]=relic.before;
    });
    markDirty(same?"prizes":"entities");refreshEntityFields();refreshRoomInfo();redraw();
    if(prize)setStatus(`Slot ${prize.slot} now holds ${dropName(prize.value)}.`);
    else if(relic)setStatus(`The relic container now holds ${withoutId(relicList().find(r=>r.value===(relic.value&0x7FFF))?.label||String(relic.value))}.`);
  };
  $("duplicateEntity").onclick=()=>{
    const e=state.selectedEntity,b=currentEntityBank();if(!e||!b||!canAddEntity())return;
    const choice={entity:e},copy=ET.makeEntity(state.discStage,choice,e.x+16,e.y+16);
    if(!copy){setStatus("No free slot or persistence index for duplication.");return;}
    const end=b.findIndex(v=>v.x===-1&&v.y===-1),previous=entityEditState();b.splice(end>=0?end:b.length,0,copy);state.selectedEntity=copy;
    pushUndo("entity duplication",()=>{b.splice(b.indexOf(copy),1);restoreEntityEditState(previous);if(currentEntityBank()===b)state.selectedEntity=e;});
    refreshEntityFields();refreshRoomInfo();markDirty("entities");redraw();
  };
  $("addEntity").onclick=()=>{
    const b=currentEntityBank();if(!b||!state.room||!canAddEntity())return;
    const choice=currentTemplates().find(value=>value.key===$("newEntityType").value);
    if(!choice){setStatus("Choose a stage template first.");return;}
    const previous=entityEditState(),selected=state.selectedEntity,dims=activeDims();
    const entry=ET.makeEntity(state.discStage,choice,Math.round(dims.tilesW*TILE_PX/2),Math.round(dims.tilesH*TILE_PX/2));
    if(!entry){setStatus("No free slot or persistence index for this template.");return;}
    b.splice(Math.max(1,b.length-1),0,entry);state.selectedEntity=entry;
    pushUndo("entity addition",()=>{b.splice(b.indexOf(entry),1);restoreEntityEditState(previous);if(currentEntityBank()===b)state.selectedEntity=selected;});
    refreshEntityFields();refreshRoomInfo();markDirty("entities");redraw();
  };
  $("deleteEntity").onclick=()=>{
    const e=state.selectedEntity,b=currentEntityBank();if(!e||!b)return;const i=b.indexOf(e);if(i<0)return;
    const previous=entityEditState();b.splice(i,1);state.selectedEntity=null;
    pushUndo("entity deletion",()=>{b.splice(i,0,e);restoreEntityEditState(previous);if(currentEntityBank()===b)state.selectedEntity=e;});
    refreshEntityFields();refreshRoomInfo();markDirty("entities");redraw();
  };

  async function saveAll(){
    try{
      for(const e of state.tilemaps.values())if(e.dirty){await writeU16(e.handle,e.values);e.dirty=false;}
      for(const td of state.tiledefs.values())if(td.dirty&&td.collisionHandle){
        const w=await td.collisionHandle.createWritable();await w.write(td.collisions);await w.close();td.dirty=false;
      }
      if(state.entitiesDirty&&state.entitiesFile&&state.entityLayouts){await writeJson(state.entitiesFile,state.entityLayouts);state.entitiesDirty=false;}
      clearUndo();updateSaveState();setStatus("Saved modified tilemaps and entity layouts.");
    }catch(e){console.error(e);alert("Save failed: "+(e.message||e));}
  }

  async function collectChanges(allowUnchanged=false) {
    if(!state.disc)throw new Error("Load a SOTN BIN first.");
    const files=new Map();
    for(const stage of state.discStages.values()) {
      if(!stage.entitiesDirty&&!roomGraphicsDirty(stage)&&!window.SotnStage.prizeDropsDirty?.(stage)&&![...stage.maps.values()].some(m=>m.dirty)&&![...stage.tiledefs.values()].some(td=>td.dirty))continue;
      const after=window.SotnStage.buildOverlay(stage,stage.entitiesDirty);
      files.set(stage.record.extent,{record:stage.record,before:stage.bytes,after});
    }
    const stats=state.statsModel;
    if(stats?.dirty()){
      const targets={};
      for(const key of stats.changedFiles()){
        const entry=stats.files[key];
        if(!entry?.record)throw new Error(`${key} is not on this disc.`);
        let file=files.get(entry.record.extent);
        if(!file){file={record:entry.record,before:entry.bytes,after:entry.bytes.slice()};files.set(entry.record.extent,file);}
        targets[key]=file.after;
      }
      window.SotnStatsModel.apply(stats,targets);
    }
    const hacks=window.SotnExtraHacksUI;
    for(const entry of hacks?.pendingEdits?.()||[]) {
      let file=files.get(entry.record.extent);
      if(!file){const bytes=await state.disc.readFile(entry.record);file={record:entry.record,before:bytes,after:bytes.slice()};files.set(entry.record.extent,file);}
      hacks.applyEdits(file,entry.edits,entry.path);
    }
    const changes=[];
    for(const file of files.values())changes.push(...await C.changedSectors(state.disc,file.record,file.before,file.after));
    changes.sort((a,b)=>a.start-b.start);
    if(!changes.length&&!allowUnchanged)throw new Error("There are no byte changes to export.");
    return window.SotnTitleCredits.add(state.disc,changes);
  }
  async function saveBlob(blob,name,allowSourceOverwrite=false) {
    const disc=state.disc;
    return window.SotnSafeSave.save(blob,name,{sourceHandle:state.discHandle,sourceFile:disc?.file,
      allowSourceOverwrite,onSourceSnapshot:file=>{disc.file=file;}});
  }
  async function saveCurrentEdits() {
    try {
      if (!state.disc) throw new Error("Load a SOTN BIN first.");
      finishPainting(); finishEntityDrag(); updateSaveState();
      const revision = state.editRevision;
      const saved = await window.SotnEditSession.capture({name:state.discName, stages:state.discStages,
        stats:state.statsModel, hacks:window.SotnExtraHacksUI, area:state.discStage?.code});
      if (revision !== state.editRevision) throw new Error("Your edits changed while saving. Use Save current edits again.");
      const stem = state.discName.replace(/\.[^.]+$/, "");
      await saveBlob(new Blob([JSON.stringify(saved)], {type:"application/json"}), `${stem}.sotn-edits.json`);
      setStatus("Current edits saved. Open a compatible BIN, then use Load saved edits to restore them.");
    } catch (error) {
      if (error.name !== "AbortError") { setStatus(error.message); alert(error.message); }
    }
  }
  async function loadSavedEdits() {
    try {
      if (!state.disc) throw new Error("Load a SOTN BIN first.");
      const {file} = await chooseFile();
      if (file.size > 32 * 1024 * 1024) throw new Error("This edit file is too large. Choose a .sotn-edits.json file.");
      const saved = window.SotnEditSession.parse(await file.text()), disc = state.disc;
      finishPainting(); finishEntityDrag(); updateSaveState();
      const revision = state.editRevision;
      setStatus("Checking saved edits against the loaded BIN...");
      const stages = new Map(state.discStages);
      for (const entry of saved.stages) if (!stages.has(entry.code)) {
        const area = state.areaCatalog.find(area => area.code === entry.code);
        if (!area) throw new Error(`Saved area ${entry.code} is not in this BIN.`);
        const stage = window.SotnStage.parseOverlay(await disc.readFile(area.overlay));
        stage.code = entry.code; stage.record = area.overlay; stage.entitiesDirty = false; initPrizeDrops(stage);
        stages.set(entry.code, stage);
      }
      const plan = await window.SotnEditSession.prepare(saved, {stats:state.statsModel, stages, hacks:window.SotnExtraHacksUI});
      if (disc !== state.disc || revision !== state.editRevision) throw new Error("The BIN or current edits changed. Load the saved edits again.");
      const restore = plan.apply();
      for (const code of plan.touched) state.discStages.set(code, stages.get(code));
      state.entityLayouts = state.discStage?.entityLayouts || state.entityLayouts;
      state.entitiesDirty = state.discStage?.entitiesDirty || false;
      pushUndo("loaded saved edits", () => {
        restore(); state.entityLayouts = state.discStage?.entityLayouts || state.entityLayouts;
        state.entitiesDirty = state.discStage?.entitiesDirty || false;
      });
      state.selectedEntity = null; state.tileCanvasCache.clear();
      refreshEntityFields(); refreshRoomInfo(); redraw(); redrawPalette();
      window.SotnEditorView?.refreshAll(); window.SotnExtraHacksUI?.refresh(); updateSaveState();
      setStatus("Saved edits loaded. Review them, keep editing, or build when ready. Undo restores your previous edits.");
    } catch (error) {
      if (error.name !== "AbortError") { setStatus(`Saved edits were not loaded: ${error.message}`); alert(error.message); }
    }
  }
  async function exportResult(kind) {
    try {
      setStatus("Checking edited overlays and disc sectors...");
      const changes=await collectChanges();
      const stem=state.discName.replace(/\.[^.]+$/,"");
      const blob=kind==="ppf"?C.ppf3Blob(changes,"SOTN Editor v7.0"):C.modifiedBlob(state.disc.file,changes);
      const saved=await saveBlob(blob,`${stem}-edits.${kind==="ppf"?"ppf":"bin"}`,kind==="bin");
      setStatus(`${kind==="ppf"?"PPF3 patch":"Modified BIN"} ${saved.downloaded?"download started":"saved and verified"} (${changes.length} changed sectors). ${saved.warning||""}`);
    } catch(e){if(e.name!=="AbortError"){
      console.error(e);if(e.extraHackConflict)window.SotnExtraHacksUI?.setConflict(e.message);
      const message = `${e.message||String(e)} Your edits are still in this tab. Use Save current edits to keep them before reopening the BIN or refreshing.`;
      setStatus(message);alert(message);
    }}
  }

  if(typeof showDirectoryPicker !== "function") {
    $("openFolder").disabled=true;
    $("openFolder").title="Asset folders require Chrome or Edge; Open SOTN BIN works here.";
  }
  $("openFolder").onclick=openAreaFolder;$("openDisc").onclick=openDisc;$("openStageGfx").onclick=openStageGraphics;$("saveAll").onclick=saveAll;
  $("saveEdits").onclick=saveCurrentEdits;$("loadEdits").onclick=loadSavedEdits;
  $("undoEdit").onclick=undoEdit;
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&(state.copyTileActive||state.copyCollisionActive)){setCopyTile(false);setCopyCollision(false);return;}
    if(!(e.ctrlKey||e.metaKey)||e.altKey||e.shiftKey)return;
    if(e.target?.closest?.("input, textarea, select, [contenteditable]"))return;
    const key=e.key.toLowerCase();
    if(key==="z"&&state.undoStack.length){e.preventDefault();undoEdit();}
    if(key==="c"&&state.tab==="map"&&state.mode==="tiles"&&state.room&&!String(window.getSelection?.()||"")){
      e.preventDefault();setCopyTile(true);setStatus("Drag a rectangle of tiles to copy; release to use the brush.");
    }
  });
  $("areaSelect").onchange=e=>selectDiscArea(e.target.value);
  $("buildBin").onclick=()=>exportResult("bin");
  $("testGame").onclick=()=>window.SotnPlayLauncher.launch(async()=>{
    finishPainting();finishEntityDrag();
    setStatus("Preparing a patched test copy...");
    const disc=state.disc,name=state.discName;
    const changes=await collectChanges(true);
    if(state.disc!==disc)throw new Error("The source changed; please test again.");
    const blob=C.modifiedBlob(disc.file,changes);
    setStatus(`Test copy ready (${changes.length} changed sectors). Your source is unchanged.`);
    return {blob,name,sectorSize:disc.sectorSize,dataOffset:disc.dataOffset};
  },setStatus);
  $("exportPpf").onclick=()=>exportResult("ppf");
  ["showFg","showBg","showEntities","showGrid","showCollision"].forEach(id=>$(id).onchange=redraw);
  $("paintLayer").onchange=()=>{state.tileBrush=null;setCopyTile(false);redrawPalette();redraw();};
  $("collisionLayer").onchange=()=>{setCopyCollision(false);updateCollisionAvailability();redraw();};
  $("tileId").onchange=()=>{state.tileBrush=null;redrawPalette();redraw();};
  $("copyTile").onclick=()=>{setCopyTile(!state.copyTileActive);if(state.copyTileActive)setStatus("Drag a rectangle of tiles to copy; release to use the brush.");};
  $("copyCollision").onclick=()=>setCopyCollision(!state.copyCollisionActive);
  $("zoomIn").onclick=()=>{state.zoom=Math.min(2,state.zoom*1.25);redraw();};
  $("zoomOut").onclick=()=>{state.zoom=Math.max(.25,state.zoom/1.25);redraw();};
  $("scrollUp").onclick=()=>$("canvasWrap").scrollBy({top:-Math.max(128,$("canvasWrap").clientHeight*0.8),behavior:"smooth"});
  $("scrollDown").onclick=()=>$("canvasWrap").scrollBy({top:Math.max(128,$("canvasWrap").clientHeight*0.8),behavior:"smooth"});
  document.querySelectorAll(".mode").forEach(btn=>btn.onclick=()=>{
    setCopyTile(false);
    setCopyCollision(false);
    state.mode=btn.dataset.mode;document.querySelectorAll(".mode").forEach(b=>b.classList.toggle("active",b===btn));
    $("tilePanel").classList.toggle("hidden",state.mode!=="tiles");$("entityPanel").classList.toggle("hidden",state.mode!=="entities");
    $("collisionPanel").classList.toggle("hidden",state.mode!=="collision");
    if(state.mode==="collision")$("showCollision").checked=true;
    redraw();
  });
  function setTab(tab) {
    state.tab=tab;
    document.querySelectorAll(".tab").forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle("active",on);b.setAttribute("aria-selected",String(on));});
    $("mapView").classList.toggle("hidden",tab!=="map");
    $("statsView").classList.toggle("hidden",tab!=="stats");
    $("shopView")?.classList.toggle("hidden",tab!=="shop");
    $("extraHacksView")?.classList.toggle("hidden",tab!=="extraHacks");
    $("ass2View")?.classList.toggle("hidden",tab!=="ass2");
    document.body.classList.toggle("statsTab",tab!=="map");
    if(tab==="stats")window.SotnStatsUI?.render();
    if(tab==="shop")window.SotnShopUI?.render();
    if(tab==="extraHacks")window.SotnExtraHacksUI?.refresh();
    if(tab==="ass2")window.SotnAss2UI?.render();
    if(tab==="map"){setCopyTile(false);setCopyCollision(false);redraw();}
  }
  document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  window.SotnStatsUI?.init({
    onChange:()=>{updateSaveState();setStatus("Unsaved stat changes.");window.SotnShopUI?.refresh();},
    pushUndo,setStatus
  });
  window.SotnShopUI?.init({
    onChange:()=>{updateSaveState();setStatus("Unsaved shop changes.");window.SotnStatsUI?.refresh();},
    pushUndo,setStatus
  });
  window.SotnExtraHacksUI?.init({
    onChange:()=>{updateSaveState();setStatus("Unsaved Extra Hacks changes.");},
    onReady:updateSaveState,
    onSelection:({selected,statsValues})=>{
      hackCosts=statsValues;
      window.SotnEditorView?.setModes({subweaponMp:!!selected.get("subweapon-mp"),holyWaterRichter:!!selected.get("holy-water-richter")});
      applyHackCosts();updateSaveState();
    },
    statsOwned:(file,offset)=>!!costField(file,offset),
    currentValue:(file,offset)=>{const id=costField(file,offset);return id?state.statsModel.get(id):undefined;},
    pushUndo,setStatus
  });

  window.addEventListener("beforeunload",e=>{if(state.dirty){e.preventDefault();e.returnValue="";}});
})();
