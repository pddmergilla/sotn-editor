(function (global) {
  "use strict";
  const BASE = 0x80180000;
  const ENTITY_SIZE = 10;
  const ENTITY_LAYOUT_COUNT = 53;
  const ENTITY_FIELDS = ["x","y","id","flags","slot","spawnId","params"];
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const s16 = (b, o) => (u16(b, o) << 16) >> 16;
  const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
  const put16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = v >>> 8 & 255; };
  const put32 = (b, o, v) => { put16(b, o, v); put16(b, o + 2, v >>> 16); };
  const offset = (b, addr, size = 1) => {
    const o = addr - BASE;
    if (!Number.isInteger(o) || o < 0 || o + size > b.length) throw new Error(`Invalid stage pointer 0x${addr.toString(16)}.`);
    return o;
  };
  const isPtr = (b, addr, size = 1) => addr >= BASE && addr - BASE + size <= b.length;
  const byte = v => (v << 24) >> 24;

  // EntityPersistentItemDrop reads PrizeDrops[params] with
  // lui at,%hi; ...; lhu rY,%lo(at); ...; sltiu rZ,rY,128 (src/st/e_collect.h).
  function findPrizeTable(b) {
    const hits = [];
    for (let o = 8; o + 4 <= b.length; o += 4) {
      const w = u32(b, o);
      if ((w >>> 26) !== 11 || (w & 0xFFFF) !== 0x80) continue;
      const src = (w >>> 21) & 31;
      for (let k = 1; k <= 2; k++) {
        const l = u32(b, o - 4 * k);
        if ((l >>> 26) !== 37 || ((l >>> 16) & 31) !== src) continue;
        const base = (l >>> 21) & 31;
        for (let j = 1; j <= 3 && o - 4 * k - 4 * j >= 0; j++) {
          const h = u32(b, o - 4 * k - 4 * j);
          if ((h >>> 26) !== 15 || ((h >>> 16) & 31) !== base) continue;
          const addr = (((h & 0xFFFF) << 16) + ((l << 16) >> 16)) >>> 0;
          if (isPtr(b, addr, 2)) hits.push(addr - BASE);
          break;
        }
        break;
      }
    }
    return hits.length === 1 ? hits[0] : -1;
  }

  // Prize containers (src/st/nz0/e_nz0_room2.c, e_blue_flame_table.c and the
  // rnz0 copies) spawn their pickup with child->params set either to
  // self->params (RNZ0) or to a u16 lookup table entry indexed by self->params
  // (NZ0). NZ0's Relic Container spawns a Relic Orb instead when
  // params >= N (sltiu rX,rX,N). ids maps area enum symbols to entity IDs; the
  // update table is the pointer run whose functions all match these patterns.
  const CONTAINER_SYMBOLS = ["E_GLOBE_TABLE", "E_RELIC_CONTAINER", "E_BLUE_FLAME_TABLE"];
  function containerPattern(b, start, end, ids) {
    const found = [];
    let relicFrom = null, spawnsDrop = false, spawnsOrb = false;
    const at = o => o >= start && o + 4 <= end ? u32(b, o) : 0;
    for (let o = start; o + 4 <= end; o += 4) {
      const w = at(o);
      // ori a0,zero,<entity ID> before CreateEntityFromEntity
      if (w >>> 16 === 0x3404) {
        if ((w & 0xFFFF) === ids.E_PERSISTENT_ITEM_DROP) spawnsDrop = true;
        if ((w & 0xFFFF) === ids.E_RELIC_ORB) spawnsOrb = true;
      }
      // lhu rX,0x30(self): self->params
      if ((w >>> 26) !== 37 || (w & 0xFFFF) !== 0x30) continue;
      const reg = w >>> 16 & 31, self = w >>> 21 & 31;
      // Skip the load delay slot, which may hold an unrelated instruction.
      let k = o + 4;
      if (at(k) === 0 || (at(k) >>> 16 & 31) !== reg && (at(k) >>> 26) !== 0) k += 4;
      const next = at(k);
      if ((next >>> 26) === 11 && (next >>> 21 & 31) === reg && (next >>> 16 & 31) === reg) relicFrom = next & 0xFFFF;
      // sh value,0xEC(self): (self + 1)->params, within a few instructions
      const storesChild = (from, value) => {
        for (let j = from; j < from + 16; j += 4) {
          const s = at(j);
          if ((s >>> 26) === 41 && (s >>> 16 & 31) === value && (s >>> 21 & 31) === self && (s & 0xFFFF) === 0xEC) return true;
          if ((s >>> 26) === 15 || (s >>> 26) === 9 && (s >>> 16 & 31) === value) return false;
        }
        return false;
      };
      if (storesChild(k, reg)) { found.push({kind: "direct"}); continue; }
      // sll r,r,1; lui at,%hi; addu at,at,r; lhu rB,%lo(at)
      if (next !== (reg << 16 | reg << 11 | 1 << 6)) continue;
      const lui = at(k + 4), add = at(k + 8), lhu = at(k + 12);
      if ((lui >>> 26) !== 15) continue;
      const base = lui >>> 16 & 31;
      if (add !== (base << 21 | reg << 16 | base << 11 | 0x21) && add !== (reg << 21 | base << 16 | base << 11 | 0x21)) continue;
      if ((lhu >>> 26) !== 37 || (lhu >>> 21 & 31) !== base) continue;
      const addr = (((lui & 0xFFFF) << 16) + ((lhu << 16) >> 16)) >>> 0;
      if (isPtr(b, addr, 2) && storesChild(k + 16, lhu >>> 16 & 31)) found.push({kind: "lookup", offset: addr - BASE});
    }
    if (found.length !== 1 || !spawnsDrop) return null;
    const rule = {...found[0]};
    if (spawnsOrb) {
      if (rule.kind !== "lookup" || relicFrom === null) return null;
      rule.relicFrom = relicFrom;
    }
    return rule;
  }
  function findContainerDrops(b, ids) {
    const want = CONTAINER_SYMBOLS.filter(s => Number.isInteger(ids?.[s]) && ids[s] > 0);
    if (!b || !want.length || !Number.isInteger(ids.E_PERSISTENT_ITEM_DROP)) return null;
    const count = Math.max(...want.map(s => ids[s]));
    const isCode = a => a >= BASE && a - BASE < b.length && !(a & 3);
    const results = [];
    for (let t = 0; t + count * 4 <= b.length; t += 4) {
      let ok = true;
      for (let i = 0; i < count && ok; i++) ok = isCode(u32(b, t + i * 4));
      if (!ok) continue;
      // Function ends: the next start among the whole pointer run.
      let run = count;
      while (t + run * 4 + 4 <= b.length && isCode(u32(b, t + run * 4))) run++;
      const starts = [...new Set(Array.from({length: run}, (_, i) => u32(b, t + i * 4) - BASE))].sort((x, y) => x - y);
      const rules = {};
      for (const symbol of want) {
        const start = u32(b, t + (ids[symbol] - 1) * 4) - BASE;
        const end = Math.min(starts.find(s => s > start) ?? b.length, start + 0x800, b.length);
        const rule = containerPattern(b, start, end, ids);
        if (!rule) { ok = false; break; }
        rules[symbol] = rule;
      }
      if (ok) results.push(rules);
    }
    if (!results.length || results.some(r => JSON.stringify(r) !== JSON.stringify(results[0]))) return null;
    return results[0];
  }

  function makeParsedStage(properties, rooms, roomHeaderOffset, roomTerminatorOffset) {
    const stage = {...properties, rooms, roomHeaderOffset, roomTerminatorOffset, prizeTableOffset: findPrizeTable(properties.bytes)};
    Object.defineProperty(stage, "originalRoomGfxIds", {
      value: Object.freeze(rooms.map(room => room.entityGfxId)),
      enumerable: true,
      writable: false,
      configurable: false
    });
    return stage;
  }

  function readBank(b, addr, limit) {
    let o = offset(b, addr, ENTITY_SIZE);
    const entries = [];
    while (o + ENTITY_SIZE <= Math.min(b.length, limit)) {
      const e = { x:s16(b,o), y:s16(b,o+2), id:b[o+4], flags:b[o+5], slot:b[o+6], spawnId:b[o+7], params:u16(b,o+8) };
      entries.push(e);
      o += ENTITY_SIZE;
      if (e.x === -1 && e.y === -1) break;
      if (entries.length > 2048) throw new Error("Entity bank is too large.");
    }
    if (entries[0]?.x !== -2 || entries[0]?.y !== -2 || entries.at(-1)?.x !== -1 || entries.at(-1)?.y !== -1) {
      throw new Error(`Invalid entity bank at 0x${addr.toString(16)}.`);
    }
    return entries;
  }

  function parseOverlay(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < 0x100) throw new Error("Stage overlay is too small.");
    const roomPtr = u32(b, 16), layerPtr = u32(b, 32);
    let layoutPtr = u32(b, 28);
    const rooms = [];
    const roomHeaderOffset = offset(b, roomPtr, 8);
    let roomTerminatorOffset = -1;
    for (let o = roomHeaderOffset; o + 8 <= b.length; o += 8) {
      if (b[o] === 0x40) {
        roomTerminatorOffset = o;
        break;
      }
      rooms.push({left:byte(b[o]), top:byte(b[o+1]), right:byte(b[o+2]), bottom:byte(b[o+3]), layerId:byte(b[o+4]), tileDefId:byte(b[o+5]), entityGfxId:b[o+6], entityLayoutId:byte(b[o+7]), roomHeaderOffset:o});
      if (rooms.length > 512) throw new Error("Room list has no terminator.");
    }
    if (!rooms.length) throw new Error("No rooms found in this overlay.");
    if (roomTerminatorOffset < 0) throw new Error("Room list has no terminator.");

    const table = offset(b, layerPtr, 8);
    const roomStart = offset(b, roomPtr, 8);
    const maps = new Map(), tiledefs = new Map(), layers = [];
    function readLayer(addr) {
      if (!isPtr(b,addr,16) || addr >= layerPtr) return null;
      const o=offset(b,addr,16), data=u32(b,o), td=u32(b,o+4), packed=u32(b,o+8);
      if (!data && !td && !packed) return null;
      const left=packed&63, top=packed>>>6&63, right=packed>>>12&63, bottom=packed>>>18&63;
      const size=(right-left+1)*(bottom-top+1)*512;
      if (size <= 0 || size > 0x20000) throw new Error("Invalid tilemap dimensions.");
      const mo=offset(b,data,size), to=offset(b,td,16);
      if (!maps.has(data)) {
        const values=new Uint16Array(size/2);
        for(let i=0;i<values.length;i++) values[i]=u16(b,mo+i*2);
        maps.set(data,{path:`map:${data}`, offset:mo, values, dirty:false});
      }
      if (!tiledefs.has(td)) {
        const ptrs=[0,4,8,12].map(n=>u32(b,to+n));
        const len=Math.min(...[ptrs[1]-ptrs[0],ptrs[2]-ptrs[1],ptrs[3]-ptrs[2]].filter(n=>n>0&&n<=4096));
        if (!Number.isFinite(len) || len < 16) throw new Error("Invalid tile definition.");
        const [pages,tiles,cluts,collisions]=ptrs.map(p=>b.slice(offset(b,p,len),offset(b,p,len)+len));
        tiledefs.set(td,{name:`tiledef:${td}`,tiles,pages,cluts,collisions,offsets:ptrs.map(p=>offset(b,p,len))});
      }
      return {data:`map:${data}`,tiledef:`tiledef:${td}`,left,top,right,bottom,flags:u16(b,o+14)};
    }
    const count=Math.max(...rooms.map(r=>r.layerId))+1;
    for(let i=0;i<count;i++) layers.push({fg:readLayer(u32(b,table+i*8)),bg:readLayer(u32(b,table+i*8+4))});

    if(!isPtr(b,layoutPtr,ENTITY_LAYOUT_COUNT*8)) {
      layoutPtr=0;
      for(let o=44;o+ENTITY_LAYOUT_COUNT*8<roomStart;o+=4) {
        const x=u32(b,o),y=u32(b,o+ENTITY_LAYOUT_COUNT*4);
        if(!isPtr(b,x,ENTITY_SIZE)||!isPtr(b,y,ENTITY_SIZE))continue;
        const xo=x-BASE,yo=y-BASE;
        if(s16(b,xo)===-2&&s16(b,xo+2)===-2&&s16(b,yo)===-2&&s16(b,yo+2)===-2) {
          layoutPtr=BASE+o;break;
        }
      }
    }
    if(!layoutPtr) {
      return makeParsedStage({bytes:b,layers,maps,tiledefs,layoutPtr:0,entityLayouts:{entities:[],indices:[]},originalEntities:[],xPtrs:[],yPtrs:[],banks:new Map()},rooms,roomHeaderOffset,roomTerminatorOffset);
    }
    const lo=offset(b,layoutPtr,ENTITY_LAYOUT_COUNT*8);
    const xPtrs=Array.from({length:ENTITY_LAYOUT_COUNT},(_,i)=>u32(b,lo+i*4));
    const yPtrs=Array.from({length:ENTITY_LAYOUT_COUNT},(_,i)=>u32(b,lo+ENTITY_LAYOUT_COUNT*4+i*4));
    const unique=[...new Set([...xPtrs,...yPtrs])].filter(p=>isPtr(b,p,ENTITY_SIZE)).sort((a,c)=>a-c);
    const banks=new Map();
    for(let i=0;i<unique.length;i++) {
      const p=unique[i],next=unique[i+1];
      const limit=next===undefined?b.length:offset(b,next,0);
      const entries=readBank(b,p,limit);
      const start=offset(b,p,0),end=start+entries.length*ENTITY_SIZE;
      let free=0;
      const freeLimit=next===undefined?end:limit;
      while(end+free+ENTITY_SIZE<=freeLimit && free<100 && b.subarray(end+free,end+free+ENTITY_SIZE).every(v=>v===0)) free+=ENTITY_SIZE;
      banks.set(p,{entries,originalEntries:entries.map(e=>({...e})),start,end,size:entries.length*ENTITY_SIZE,raw:b.slice(start,end),capacity:entries.length+free/ENTITY_SIZE});
    }
    const entities=[],indices=[];
    for(let i=0;i<ENTITY_LAYOUT_COUNT;i++) {
      const xBank=banks.get(xPtrs[i]),yBank=banks.get(yPtrs[i]);
      if(!xBank||!yBank) {
        indices.push(-1);
        continue;
      }
      const entries=xBank.originalEntries.map(e=>({...e})),queues=new Map();
      yBank.originalEntries.forEach((e,n)=>{
        const key=entityKey(e);
        if(!queues.has(key))queues.set(key,[]);
        queues.get(key).push(n);
      });
      for(const e of entries) {
        const key=entityKey(e);
        e.yOrder=queues.get(key)?.shift()??0;
      }
      indices.push(entities.length);
      entities.push(entries);
    }
    const entityLayouts={entities,indices};
    const originalEntities=entities.map(list=>list.map(e=>({...e})));
    return makeParsedStage({bytes:b,layers,maps,tiledefs,layoutPtr,entityLayouts,originalEntities,xPtrs,yPtrs,banks},rooms,roomHeaderOffset,roomTerminatorOffset);
  }

  // How an entity's params pick what it gives (see src/st/e_breakable*.h and
  // ReplaceBreakableWithItemDrop). symbol is the entity's area enum name.
  // stage (optional) supplies prize container rules from initContainerDrops.
  function dropRule(code,symbol,params,stage) {
    if(symbol==="E_PERSISTENT_ITEM_DROP")return params<256?{kind:"slot",slot:params,symbol}:null;
    const container=stage?.containerDrops?.rules?.[symbol];
    if(container) {
      if(params>=256)return null;
      if(container.kind==="direct")return {kind:"slot",slot:params,symbol};
      const table=stage.containerDrops.tables.get(container.offset);
      if(!table||params>=table.values.length)return null;
      const lookup={offset:container.offset,index:params};
      if(container.relicFrom!==undefined&&params>=container.relicFrom)return {kind:"relic",relic:table.values[params],lookup,symbol};
      return {kind:"slot",slot:table.values[params],lookup,symbol};
    }
    if(symbol==="E_BREAKABLE") {
      const cat=global.SotnStatsCatalog||(typeof require==="function"?require("./stats-catalog.js"):null);
      const look=params>>12,rule=cat?.BREAKABLE_RULES?.[String(code).toUpperCase()]?.[look];
      if(rule==="slot")return {kind:"slot",slot:params&0x1FF,look,symbol};
      if(Number.isInteger(rule))return {kind:"fixed",slot:rule,look,symbol};
      return {kind:"direct",value:params&0xFFF,look,symbol};
    }
    if(symbol==="E_SUBWPN_CONTAINER")return {kind:"subweapon",index:params,symbol};
    return null;
  }
  function prizeTableLength(stage, highestSlot) {
    const bounds={
      RNO4:[0x1620,32,[16,32,48,64,80,96,112,0]],
      RNO2:[0xD40,12,[32768,65535,0,0,61440,65535,57344,65535]],
      RLIB:[0xBC8,18,[259,515,771,1027,1283,1539,1795,0]],
      BO3:[0x108C,38,[0,0,0,0,1,0,1,0]]
    }[String(stage.code).toUpperCase()];
    if(!bounds)return highestSlot+1;
    const [offset,length,next]=bounds,end=offset+length*2;
    if(stage.prizeTableOffset!==offset||end+16>stage.bytes.length||
      next.some((value,i)=>u16(stage.bytes,end+i*2)!==value))
      throw new Error(`${stage.code} prize table boundary is not recognized.`);
    return length;
  }
  // subweapon_params[] of EntitySubWeaponContainer: nine s32 subweapon ITEMDROP IDs (14-22).
  function findSubweaponTable(b) {
    const want=[...Array(9).keys()].map(i=>i+14).join(",");
    for(let o=0;b&&o+36<=b.length;o+=4) {
      const v=[];
      for(let i=0;i<9;i++){const w=u32(b,o+i*4);if(w<14||w>22)break;v.push(w);}
      if(v.length===9&&v.slice().sort((x,y)=>x-y).join(",")===want)return v;
    }
    return null;
  }
  // Reads the containers' lookup tables. A table's length is the highest
  // index any original placement uses; later entries may be other data.
  function initContainerDrops(stage, ids) {
    stage.containerDrops = null;
    const rules = findContainerDrops(stage.bytes, ids);
    if (!rules) return null;
    const symbols = new Map(Object.entries(ids || {}).map(([symbol, id]) => [id, symbol]));
    const lengths = new Map();
    for (const bank of stage.originalEntities || []) for (const e of bank) {
      const rule = rules[symbols.get(e.id)];
      if (rule?.kind === "lookup" && e.x !== -1 && e.x !== -2 && e.params < 256)
        lengths.set(rule.offset, Math.max(lengths.get(rule.offset) || 0, e.params + 1));
    }
    const tables = new Map();
    for (const [off, length] of lengths) {
      if (off + length * 2 > stage.bytes.length) continue;
      const original = Uint16Array.from({length}, (_, i) => u16(stage.bytes, off + i * 2));
      tables.set(off, {offset: off, original, values: original.slice()});
    }
    stage.containerDrops = {rules, tables};
    return stage.containerDrops;
  }
  function prizeDropsDirty(stage) {
    const p = stage?.prizeDrops;
    return !!p && p.values.some((v, i) => v !== p.original[i]) ||
      [...(stage?.containerDrops?.tables?.values() || [])].some(t => t.values.some((v, i) => v !== t.original[i]));
  }

  function roomGraphicsDirty(stage) {
    return Array.isArray(stage?.rooms) && Array.isArray(stage?.originalRoomGfxIds) &&
      stage.rooms.some((room,index)=>room?.entityGfxId!==stage.originalRoomGfxIds[index]);
  }

  function validateRoomGraphics(stage) {
    const b=stage?.bytes,rooms=stage?.rooms,original=stage?.originalRoomGfxIds;
    if(!(b instanceof Uint8Array)||!Array.isArray(rooms)||!rooms.length||!Array.isArray(original)||original.length!==rooms.length) {
      throw new Error("Room graphics metadata is incomplete.");
    }
    if(!Object.isFrozen(original))throw new Error("Original room graphics IDs are not immutable.");
    const expectedStart=offset(b,u32(b,16),(rooms.length+1)*8);
    if(stage.roomHeaderOffset!==expectedStart)throw new Error("Room header offset is invalid.");
    const expectedTerminator=expectedStart+rooms.length*8;
    if(stage.roomTerminatorOffset!==expectedTerminator||b[expectedTerminator]!==0x40) {
      throw new Error("Room list terminator is invalid.");
    }
    for(let i=0;i<rooms.length;i++) {
      const headerOffset=expectedStart+i*8,room=rooms[i],originalId=original[i],currentId=room?.entityGfxId;
      if(room?.roomHeaderOffset!==headerOffset||!Number.isInteger(headerOffset)||headerOffset<0||headerOffset+8>b.length) {
        throw new Error(`Room ${i} header offset is invalid.`);
      }
      if(!Number.isInteger(originalId)||originalId<0||originalId>255||b[headerOffset+6]!==originalId) {
        throw new Error(`Room ${i} original graphics data does not match the source.`);
      }
      if(!Number.isInteger(currentId)||currentId<0||currentId>255) {
        throw new Error(`Room ${i} graphics ID must be a byte.`);
      }
    }
  }

  function writeEntry(b,o,e) {
    const id=Number(e.id);
    if(!Number.isInteger(id)||id<0||id>255) throw new Error("Entity ID must be 0-255 (decimal or 0x hex).");
    for(const [name,v,min,max] of [["X",e.x,-32768,32767],["Y",e.y,-32768,32767],["Flags",e.flags,0,255],["Slot",e.slot,0,255],["Spawn ID",e.spawnId,0,255],["Params",e.params,0,65535]]) {
      if(!Number.isInteger(v)||v<min||v>max) throw new Error(`${name} is out of range.`);
    }
    put16(b,o,e.x);put16(b,o+2,e.y);b[o+4]=id;b[o+5]=e.flags;b[o+6]=e.slot;b[o+7]=e.spawnId;put16(b,o+8,e.params);
  }

  function sameEntityRows(a,b) {
    if(!a||!b||a.length!==b.length)return false;
    const counts=new Map();
    for(const e of a.slice(1,-1)) {
      const key=entityKey(e);
      counts.set(key,(counts.get(key)||0)+1);
    }
    for(const e of b.slice(1,-1)) {
      const key=entityKey(e),count=counts.get(key)||0;
      if(!count)return false;
      if(count===1)counts.delete(key);else counts.set(key,count-1);
    }
    return counts.size===0;
  }

  function entityKey(e) {
    return ENTITY_FIELDS.map(k=>e[k]).join(":");
  }

  function entriesChanged(entries,original) {
    return !original||original.length!==entries.length||entries.some((e,n)=>ENTITY_FIELDS.some(k=>e[k]!==original[n]?.[k]));
  }

  function serializeBank(entries,axis,sentinels=entries) {
    if(!Array.isArray(entries)||entries.length<2||!Array.isArray(sentinels)||sentinels.length<2||
      entries[0].x!==-2||entries[0].y!==-2||entries.at(-1).x!==-1||entries.at(-1).y!==-1||
      sentinels[0].x!==-2||sentinels[0].y!==-2||sentinels.at(-1).x!==-1||sentinels.at(-1).y!==-1) {
      throw new Error("Entity bank sentinels are invalid.");
    }
    const middle=entries.slice(1,-1).map((entry,index)=>({entry,index}));
    middle.sort((a,b)=>{
      const order=a.entry[axis]-b.entry[axis];
      if(order!==0)return order;
      if(axis==="y") {
        const ay=Number.isInteger(a.entry.yOrder)?a.entry.yOrder:a.index;
        const by=Number.isInteger(b.entry.yOrder)?b.entry.yOrder:b.index;
        if(ay!==by)return ay-by;
      }
      return a.index-b.index;
    });
    const ordered=[sentinels[0],...middle.map(item=>item.entry),sentinels.at(-1)];
    const bytes=new Uint8Array(ordered.length*ENTITY_SIZE);
    ordered.forEach((entry,index)=>writeEntry(bytes,index*ENTITY_SIZE,entry));
    return bytes;
  }

  function bytesKey(bytes) {
    let key="";
    for(const value of bytes)key+=value.toString(16).padStart(2,"0");
    return key;
  }

  function reconcileYEntries(entries,original,yOriginal,layoutId) {
    const before=original.slice(1,-1),after=entries.slice(1,-1),yRows=yOriginal.slice(1,-1);
    const paired=new Map(),newRows=[];
    if(before.length===after.length&&before.every((row,index)=>row.slot===after[index].slot)) {
      before.forEach((_,index)=>paired.set(index,after[index]));
    } else {
      const remaining=new Set(before.map((_,index)=>index));
      for(const row of after) {
        const candidates=test=>[...remaining].filter(index=>test(before[index]));
        const exact=candidates(old=>old.slot===row.slot&&old.x===row.x&&old.y===row.y);
        const slot=candidates(old=>old.slot===row.slot);
        const hits=exact.length?exact:slot;
        if(hits.length===1) {
          paired.set(hits[0],row);remaining.delete(hits[0]);
        } else if(!before.some(old=>old.slot===row.slot))newRows.push(row);
        else throw new Error(`Entity layout ${layoutId} cannot identify the edited entity in slot ${row.slot}.`);
      }
    }
    const matched=new Set(),replacements=new Map(),removed=new Set();
    for(const [oldIndex,old] of before.entries()) {
      const updated=paired.get(oldIndex);
      if(updated&&ENTITY_FIELDS.every(field=>updated[field]===old[field]))continue;
      const candidates=(test)=>yRows.map((row,index)=>({row,index}))
        .filter(({row,index})=>!matched.has(index)&&test(row)).map(({index})=>index);
      const exact=candidates(row=>row.x===old.x&&row.y===old.y&&row.slot===old.slot);
      const place=candidates(row=>row.x===old.x&&row.y===old.y);
      const slot=candidates(row=>row.slot===old.slot);
      const hits=exact.length?exact:place.length?place:slot;
      if(hits.length!==1) {
        throw new Error(`Entity layout ${layoutId} cannot match slot ${old.slot} at ${old.x}, ${old.y} in its Y bank.`);
      }
      const index=hits[0];matched.add(index);
      if(updated)replacements.set(index,{...updated});else removed.add(index);
    }
    const yMiddle=yRows.flatMap((row,index)=>removed.has(index)?[]:[replacements.get(index)||{...row}]);
    for(const row of newRows)yMiddle.push({...row});
    return [{...yOriginal[0]},...yMiddle,{...yOriginal.at(-1)}];
  }

  function layoutGroups(stage) {
    if(!stage||!Array.isArray(stage.xPtrs)||!Array.isArray(stage.yPtrs)||
      stage.xPtrs.length!==ENTITY_LAYOUT_COUNT||stage.yPtrs.length!==ENTITY_LAYOUT_COUNT||
      !Array.isArray(stage.entityLayouts?.entities)||!Array.isArray(stage.entityLayouts?.indices)||
      !Array.isArray(stage.originalEntities)||typeof stage.banks?.get!=="function")return null;
    const groups=[];
    for(let i=0;i<ENTITY_LAYOUT_COUNT;i++) {
      const xPtr=stage.xPtrs[i],yPtr=stage.yPtrs[i];
      const entityIndex=stage.entityLayouts.indices[i];
      const entries=stage.entityLayouts.entities[entityIndex],original=stage.originalEntities[entityIndex];
      const xBank=stage.banks.get(xPtr),yBank=stage.banks.get(yPtr);
      if(!xBank||!yBank||!Number.isInteger(entityIndex)||entityIndex<0||
        !Array.isArray(entries)||!Array.isArray(original)) {
        if(Array.isArray(entries)&&entriesChanged(entries,original)) {
          throw new Error(`Entity layout ${i} has an incomplete X/Y pair and cannot be edited safely.`);
        }
        groups.push(null);
        continue;
      }
      if(!sameEntityRows(original,yBank.originalEntries)&&!entriesChanged(entries,original)) {
        groups.push(null);
        continue;
      }
      const yEntries=sameEntityRows(original,yBank.originalEntries)?entries:
        reconcileYEntries(entries,original,yBank.originalEntries,i);
      groups.push({layoutId:i,entityIndex,xPtr,yPtr,xBank,yBank,entries,yEntries,original});
    }
    return groups;
  }

  function analyzeRepack(stage) {
    try {
      const b=stage?.bytes;
      if(!(b instanceof Uint8Array)||!stage.layoutPtr)return {ok:false,reason:"the entity pointer table is unavailable"};
      const tableStart=offset(b,stage.layoutPtr,ENTITY_LAYOUT_COUNT*8),tableEnd=tableStart+ENTITY_LAYOUT_COUNT*8;
      const groups=layoutGroups(stage);
      if(!groups)return {ok:false,reason:"the entity banks do not form complete layout pairs"};
      for(let i=0;i<ENTITY_LAYOUT_COUNT;i++) {
        if(u32(b,tableStart+i*4)!==stage.xPtrs[i]||u32(b,tableStart+(ENTITY_LAYOUT_COUNT+i)*4)!==stage.yPtrs[i]) {
          return {ok:false,reason:"the parsed entity table has changed"};
        }
      }
      const pointers=[...new Set([...stage.xPtrs,...stage.yPtrs])];
      const bankList=[];
      for(const ptr of pointers) {
        const bank=stage.banks.get(ptr);
        if(!bank) {
          if(isPtr(b,ptr,ENTITY_SIZE))return {ok:false,reason:"an entity bank could not be parsed"};
          continue;
        }
        if(!bank||!(bank.raw instanceof Uint8Array)||!Number.isInteger(bank.size)||
          bank.start!==ptr-BASE||bank.end!==bank.start+bank.size||bank.raw.length!==bank.size||
          !isPtr(b,ptr,bank.raw.length)||bank.raw.some((value,index)=>value!==b[bank.start+index])) {
          return {ok:false,reason:"an entity bank is outside the parsed overlay"};
        }
        bankList.push(bank);
      }
      bankList.sort((a,b)=>a.start-b.start);
      const spanStart=bankList[0]?.start,spanEnd=bankList.at(-1)?.end;
      if(!Number.isInteger(spanStart)||!Number.isInteger(spanEnd)||spanEnd<=spanStart||
        tableStart<spanEnd&&tableEnd>spanStart) return {ok:false,reason:"the entity table overlaps its banks"};
      let cursor=spanStart;
      for(const bank of bankList) {
        if(bank.start<cursor)return {ok:false,reason:"entity banks overlap"};
        if(b.subarray(cursor,bank.start).some(value=>value!==0))return {ok:false,reason:"bytes between entity banks are not zero"};
        cursor=bank.end;
      }
      for(let o=0;o+4<=b.length;o+=4) {
        if(o<tableEnd&&o+4>tableStart||o>=spanStart&&o<spanEnd)continue;
        const target=u32(b,o)-BASE;
        if(target>=spanStart&&target<spanEnd)return {ok:false,reason:"another overlay pointer refers into the entity bank span"};
      }
      const payloads=new Map();
      for(let i=0;i<ENTITY_LAYOUT_COUNT;i++) {
        const group=groups[i];
        if(!group) {
          payloads.set(i,{xBytes:stage.banks.get(stage.xPtrs[i])?.raw||null,
            yBytes:stage.banks.get(stage.yPtrs[i])?.raw||null});
          continue;
        }
        let xBytes=group.xBank.raw,yBytes=group.yBank.raw;
        if(entriesChanged(group.entries,group.original)) {
          xBytes=serializeBank(group.entries,"x",group.xBank.originalEntries);
          yBytes=serializeBank(group.yEntries,"y",group.yBank.originalEntries);
        }
        payloads.set(group.layoutId,{xBytes,yBytes});
      }
      const uniqueBytes=new Map();
      for(const payload of payloads.values())for(const bytes of [payload.xBytes,payload.yBytes]) {
        if(bytes)uniqueBytes.set(bytesKey(bytes),bytes);
      }
      const usedBytes=[...uniqueBytes.values()].reduce((total,bytes)=>total+bytes.length,0);
      if(usedBytes>spanEnd-spanStart)return {ok:false,reason:"the deduplicated entity banks exceed the original span"};
      return {ok:true,b,tableStart,spanStart,spanEnd,groups,payloads,usedBytes};
    } catch(error) {
      return {ok:false,reason:error.message||"the entity banks are unsafe to repack"};
    }
  }

  function entityRepackCapacity(stage) {
    const plan=analyzeRepack(stage);
    if(!plan.ok)return 0;
    let maximum=0;
    for(const group of plan.groups) {
      if(!group)continue;
      const otherBanks=new Map();
      for(let i=0;i<ENTITY_LAYOUT_COUNT;i++) {
        if(i===group.layoutId)continue;
        const payload=plan.payloads.get(i);
        for(const bytes of [payload.xBytes,payload.yBytes])if(bytes)otherBanks.set(bytesKey(bytes),bytes);
      }
      const own=plan.payloads.get(group.layoutId);
      const used=[...otherBanks.values()].reduce((total,bytes)=>total+bytes.length,own.xBytes.length+own.yBytes.length);
      maximum=Math.max(maximum,Math.floor((plan.spanEnd-plan.spanStart-used)/(ENTITY_SIZE*2)));
    }
    return Math.max(0,maximum);
  }

  function repackBanks(out,plan,stage) {
    const compact=new Uint8Array(plan.spanEnd-plan.spanStart),targets=new Map();
    let cursor=0;
    function targetFor(bytes) {
      const key=bytesKey(bytes);
      if(targets.has(key))return targets.get(key).address;
      if(cursor+bytes.length>compact.length)throw new Error("Entity bank repack exceeds the original bank span.");
      const address=BASE+plan.spanStart+cursor;
      targets.set(key,{address,offset:cursor,bytes});
      cursor+=bytes.length;
      return address;
    }
    const newX=[],newY=[];
    for(let i=0;i<ENTITY_LAYOUT_COUNT;i++) {
      const payload=plan.payloads.get(i);
      if(!payload)throw new Error(`Entity layout ${i} has no bank data.`);
      newX.push(payload.xBytes?targetFor(payload.xBytes):stage.xPtrs[i]);
      newY.push(payload.yBytes?targetFor(payload.yBytes):stage.yPtrs[i]);
    }
    for(const item of targets.values())compact.set(item.bytes,item.offset);
    out.set(compact,plan.spanStart);
    for(let i=0;i<ENTITY_LAYOUT_COUNT;i++) {
      put32(out,plan.tableStart+i*4,newX[i]);
      put32(out,plan.tableStart+(ENTITY_LAYOUT_COUNT+i)*4,newY[i]);
    }
  }

  function buildOverlay(stage, dirtyEntities=false) {
    validateRoomGraphics(stage);
    if(dirtyEntities&&["RNO4","RNO2","RLIB","BO3"].includes(String(stage.code).toUpperCase())) {
      const limit=prizeTableLength(stage,0);
      const cat=global.SotnEntityCatalog||(typeof require==="function"?require("./entity-catalog.js"):null);
      for(const [i,bank] of stage.entityLayouts.entities.entries())for(const entity of bank) {
        const rule=dropRule(stage.code,cat.typeFor(stage.code,entity.id).symbol,entity.params,stage);
        if(!["slot","fixed"].includes(rule?.kind)||rule.slot<limit)continue;
        const unchanged=stage.originalEntities[i]?.some(original=>
          ENTITY_FIELDS.every(field=>entity[field]===original[field]));
        if(!unchanged)throw new Error(`Choose a prize slot from 0 to ${limit-1}.`);
      }
    }
    const out=stage.bytes.slice();
    for(let i=0;i<stage.rooms.length;i++) {
      if(stage.rooms[i].entityGfxId!==stage.originalRoomGfxIds[i]) {
        out[stage.rooms[i].roomHeaderOffset+6]=stage.rooms[i].entityGfxId;
      }
    }
    for(const m of stage.maps.values()) if(m.dirty) {
      for(let i=0;i<m.values.length;i++) put16(out,m.offset+i*2,m.values[i]);
    }
    for(const td of stage.tiledefs.values()) if(td.dirty) {
      out.set(td.collisions,td.offsets[3]);
    }
    const prizes=stage.prizeDrops;
    if(prizes) for(let i=0;i<prizes.values.length;i++) if(prizes.values[i]!==prizes.original[i]) {
      const at=prizes.offset+i*2;
      if(at<0||at+2>out.length||u16(stage.bytes,at)!==prizes.original[i])throw new Error("The stage prize table does not match the source.");
      put16(out,at,prizes.values[i]);
    }
    for(const table of stage.containerDrops?.tables?.values()||[]) for(let i=0;i<table.values.length;i++) if(table.values[i]!==table.original[i]) {
      const at=table.offset+i*2;
      if(at<0||at+2>out.length||u16(stage.bytes,at)!==table.original[i])throw new Error("The stage container table does not match the source.");
      put16(out,at,table.values[i]);
    }
    if(dirtyEntities) {
      const groups=layoutGroups(stage);
      if(!groups)throw new Error("Entity layout pairs are incomplete.");
      const changed=[];
      let hasGrowth=false,needsRepack=false;
      for(const group of groups) {
        if(!group)continue;
        const {layoutId,entityIndex,xPtr,yPtr,xBank,yBank,entries,original}=group;
        if(!entriesChanged(entries,original))continue;
        if(entries.length>original.length||group.yEntries.length>yBank.originalEntries.length)hasGrowth=true;
        const shared=[xPtr,yPtr].some(ptr=>stage.xPtrs.some((other,j)=>j!==layoutId&&(other===ptr||stage.yPtrs[j]===ptr)));
        if(entries.length>xBank.capacity||group.yEntries.length>yBank.capacity||shared||xPtr===yPtr)needsRepack=true;
        changed.push({layoutId,entityIndex,xAddr:xPtr,yAddr:yPtr,xBank,yBank,entries,yEntries:group.yEntries,original});
      }
      if(hasGrowth||needsRepack) {
        const plan=analyzeRepack(stage);
        if(!plan.ok)throw new Error(`Entity layout cannot be saved safely: ${plan.reason}.`);
        if(needsRepack) {
          repackBanks(out,plan,stage);
          return out;
        }
      }
      for(const change of changed) {
        const {xAddr,yAddr,xBank,yBank,entries,yEntries,original,index}=change;
        if(entries.length>xBank.capacity)throw new Error(`Entity bank ${index} has no room for ${entries.length} entries.`);
        if(yEntries.length>yBank.capacity)throw new Error(`Vertical entity bank ${index} has no room for ${yEntries.length} entries.`);
        const middle=entries.slice(1,-1),yMiddle=yEntries.slice(1,-1);
        function movedPastNeighbor(list,prior,axis) {
          if(prior.length!==list.length)return true;
          const order=list=>list.map((e,n)=>({value:e[axis],n})).sort((a,b)=>a.value-b.value||a.n-b.n).map(e=>e.n);
          return order(prior).some((n,j)=>n!==order(list)[j]);
        }
        const xs=movedPastNeighbor(middle,original.slice(1,-1),"x")?middle.slice().sort((a,b)=>a.x-b.x):middle;
        const ys=movedPastNeighbor(yMiddle,yBank.originalEntries.slice(1,-1),"y")?
          yMiddle.slice().sort((a,b)=>a.y-b.y||(a.yOrder??0)-(b.yOrder??0)):
          yMiddle.slice().sort((a,b)=>(a.yOrder??0)-(b.yOrder??0));
        for(const [addr,list,bank] of [[xAddr,[entries[0],...xs,entries.at(-1)],xBank],
          [yAddr,[yEntries[0],...ys,yEntries.at(-1)],yBank]]) {
          const start=offset(out,addr,list.length*ENTITY_SIZE);
          list.forEach((e,n)=>writeEntry(out,start+n*ENTITY_SIZE,e));
          const writtenEnd=start+list.length*ENTITY_SIZE;
          if(writtenEnd<bank.end)out.fill(0,writtenEnd,bank.end);
        }
      }
    }
    return out;
  }

  const api={parseOverlay,buildOverlay,entityRepackCapacity,roomGraphicsDirty,prizeDropsDirty,findPrizeTable,dropRule,prizeTableLength,findSubweaponTable,findContainerDrops,initContainerDrops};
  global.SotnStage=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
