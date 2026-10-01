(function (global) {
  "use strict";

  const CLUT_INDICES = [
    0x5C00, 0x5C20, 0x7C00, 0x7C20,
    0xDC00, 0xDC20, 0xFC00, 0xFC20,
    0x15C00, 0x15C20, 0x17C00, 0x17C20,
    0x1DC00, 0x1DC20, 0x1FC00, 0x1FC20,
  ];

  function readU32LE(bytes, off) {
    return (bytes[off] | (bytes[off+1] << 8) | (bytes[off+2] << 16) | (bytes[off+3] << 24)) >>> 0;
  }

  function ascii(bytes, off, len) {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[off+i]);
    return s;
  }

  function paletteOffset(index) {
    return CLUT_INDICES[index & 0x0F] + 0x40 * Math.floor(index / 16);
  }

  function decodePsxColor16(c) {
    if ((c & 0x7FFF) === 0 && (c & 0x8000) === 0) return [0,0,0,0];
    return [
      (c & 0x1F) << 3,
      ((c >> 5) & 0x1F) << 3,
      ((c >> 10) & 0x1F) << 3,
      255
    ];
  }

  function decodePalette(stageBytes, index) {
    const off = paletteOffset(index);
    if (!stageBytes || off < 0 || off + 32 > stageBytes.length) return null;
    const out = new Array(16);
    for (let i = 0; i < 16; i++) {
      const c = stageBytes[off + i*2] | (stageBytes[off + i*2 + 1] << 8);
      out[i] = decodePsxColor16(c);
    }
    return out;
  }

  // F_<AREA>.BIN is loaded by the game as 0x2000-byte 128x128 4bpp quadrants.
  // Four quadrants form one 256x256 texture page. Pages 0..3 reserve their
  // final 16 scanlines for CLUT data, matching tools/gfxstage.py.
  function decodeStagePages(stageBytes) {
    const pageCount = Math.floor(stageBytes.length / 0x8000);
    const pages = [];
    for (let p = 0; p < pageCount; p++) {
      const pixels = new Uint8Array(256 * 256);
      for (let q = 0; q < 4; q++) {
        const block = (p * 4 + q) * 0x2000;
        if (block + 0x2000 > stageBytes.length) continue;
        const x0 = (q & 1) ? 128 : 0;
        const y0 = (q & 2) ? 128 : 0;
        const h = (p < 4 && (q & 2)) ? 112 : 128;
        for (let y = 0; y < h; y++) {
          const row = block + y * 64;
          for (let xb = 0; xb < 64; xb++) {
            const b = stageBytes[row + xb];
            const x = x0 + xb * 2;
            const dst = (y0 + y) * 256 + x;
            pixels[dst] = b & 0x0F;
            pixels[dst + 1] = (b >> 4) & 0x0F;
          }
        }
      }
      pages.push(pixels);
    }
    return pages;
  }

  function renderTileRGBA(stageBytes, pages, tiledef, tileId, clutAlt) {
    if (!tiledef || !stageBytes || !pages || tileId === 0) return new Uint8ClampedArray(16*16*4);
    if (tileId < 0 || tileId >= tiledef.tiles.length ||
        tileId >= tiledef.pages.length || tileId >= tiledef.cluts.length) {
      return null;
    }
    const cell = tiledef.tiles[tileId];
    const pageIndex = tiledef.pages[tileId];
    const clutIndex = tiledef.cluts[tileId] + (clutAlt ? 0x100 : 0);
    const page = pages[pageIndex];
    const palette = decodePalette(stageBytes, clutIndex);
    if (!page || !palette) return null;

    const u = (cell & 0x0F) * 16;
    const v = ((cell >> 4) & 0x0F) * 16;
    const rgba = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const pal = palette[page[(v+y)*256 + (u+x)]] || [0,0,0,0];
        const d = (y*16+x)*4;
        rgba[d] = pal[0]; rgba[d+1] = pal[1]; rgba[d+2] = pal[2]; rgba[d+3] = pal[3];
      }
    }
    return rgba;
  }

  function normalizeIsoName(name) {
    return String(name || "").replace(/;[0-9]+$/,"").toUpperCase();
  }

  function parseDirRecord(bytes, off) {
    if (off >= bytes.length) return null;
    const len = bytes[off];
    if (!len) return { padding:true, length:1 };
    if (off + len > bytes.length || len < 34) return null;
    const nameLen = bytes[off+32];
    const raw = bytes.slice(off+33, off+33+nameLen);
    let name;
    if (nameLen === 1 && raw[0] === 0) name = ".";
    else if (nameLen === 1 && raw[0] === 1) name = "..";
    else name = ascii(raw,0,raw.length);
    return {
      length: len,
      extent: readU32LE(bytes,off+2),
      size: readU32LE(bytes,off+10),
      flags: bytes[off+25],
      isDirectory: !!(bytes[off+25] & 2),
      name
    };
  }

  class DiscImage {
    constructor(file, sectorSize, dataOffset) {
      this.file = file;
      this.sectorSize = sectorSize;
      this.dataOffset = dataOffset;
      this.root = null;
    }

    static async open(file) {
      const candidates = [
        {sectorSize:2048, dataOffset:0},
        {sectorSize:2352, dataOffset:24}, // PS1 Mode 2 Form 1
        {sectorSize:2352, dataOffset:16}, // Mode 1 fallback
      ];
      for (const c of candidates) {
        const start = 16*c.sectorSize + c.dataOffset;
        if (start + 2048 > file.size) continue;
        const b = new Uint8Array(await file.slice(start,start+2048).arrayBuffer());
        if (b[0] === 1 && ascii(b,1,5) === "CD001") {
          const disc = new DiscImage(file,c.sectorSize,c.dataOffset);
          const root = parseDirRecord(b,156);
          if (!root || root.padding) throw new Error("ISO root directory record is invalid.");
          disc.root = root;
          return disc;
        }
      }
      throw new Error("Could not detect a PS1/ISO9660 data track. Expected 2048-byte ISO or 2352-byte BIN sectors.");
    }

    async readUserData(lba, size) {
      const out = new Uint8Array(size);
      const sectors = Math.ceil(size/2048);
      // Read up to 256 raw sectors per slice, then copy each sector's user data.
      for (let first = 0; first < sectors; first += 256) {
        const count = Math.min(256, sectors-first);
        const start = (lba+first)*this.sectorSize;
        const raw = new Uint8Array(await this.file.slice(start,start+count*this.sectorSize).arrayBuffer());
        for (let s = 0; s < count; s++) {
          const written = (first+s)*2048, take = Math.min(2048, size-written);
          const at = s*this.sectorSize + this.dataOffset;
          if (at+take > raw.length) throw new Error("Unexpected end of disc image.");
          out.set(raw.subarray(at,at+take),written);
        }
      }
      return out;
    }

    async readDirectory(record) {
      const bytes = await this.readUserData(record.extent,record.size);
      const out = [];
      let off = 0;
      while (off < bytes.length) {
        const rec = parseDirRecord(bytes,off);
        if (!rec) break;
        if (rec.padding) {
          off = Math.ceil((off+1)/2048)*2048;
          continue;
        }
        if (rec.name !== "." && rec.name !== "..") out.push(rec);
        off += rec.length;
      }
      return out;
    }

    async findPath(parts) {
      let cur = this.root;
      for (const part of parts) {
        if (!cur.isDirectory) throw new Error(`${cur.name || "root"} is not a directory.`);
        const entries = await this.readDirectory(cur);
        const want = normalizeIsoName(part);
        const next = entries.find(e => normalizeIsoName(e.name) === want);
        if (!next) throw new Error(`Disc path not found: ${parts.join("/")}`);
        cur = next;
      }
      return cur;
    }

    async readFile(record) {
      if (record.isDirectory) throw new Error("Cannot read a directory as a file.");
      return this.readUserData(record.extent,record.size);
    }

    async findStageGraphics(stageCode) {
      const dir = await this.findPath(["ST",stageCode]);
      const entries = await this.readDirectory(dir);
      const exact = `F_${stageCode}.BIN`;
      let rec = entries.find(e => !e.isDirectory && normalizeIsoName(e.name) === exact);
      if (!rec) {
        rec = entries.find(e => !e.isDirectory &&
          normalizeIsoName(e.name).startsWith("F_") &&
          normalizeIsoName(e.name).endsWith(".BIN"));
      }
      if (!rec) throw new Error(`No F_*.BIN stage graphics found in ST/${stageCode}.`);
      return {record:rec, bytes:await this.readFile(rec)};
    }

    async listStages() {
      const st = await this.findPath(["ST"]);
      const dirs = await this.readDirectory(st);
      const found = [];
      for (const dir of dirs.filter(e => e.isDirectory)) {
        const code = normalizeIsoName(dir.name);
        const files = await this.readDirectory(dir);
        const overlay = files.find(e => !e.isDirectory && normalizeIsoName(e.name) === `${code}.BIN`);
        const gfx = files.find(e => !e.isDirectory && normalizeIsoName(e.name) === `F_${code}.BIN`);
        if (overlay && gfx) found.push({code,overlay,gfx});
      }
      return found;
    }
  }

  const edcTable = new Uint32Array(256);
  const eccForward = new Uint8Array(256), eccBackward = new Uint8Array(256);
  for (let i=0;i<256;i++) {
    let e=i;
    for(let j=0;j<8;j++) e=(e>>>1)^((e&1)?0xD8018001:0);
    edcTable[i]=e>>>0;
    const f=((i<<1)^((i&128)?0x11D:0))&255;
    eccForward[i]=f; eccBackward[i^f]=i;
  }
  function edc(bytes,start,count) {
    let value=0;
    for(let i=start;i<start+count;i++) value=(value>>>8)^edcTable[(value^bytes[i])&255];
    return value>>>0;
  }
  function eccBlock(sector,majorCount,minorCount,majorMult,minorInc,dest) {
    const size=majorCount*minorCount;
    for(let major=0;major<majorCount;major++) {
      let index=(major>>>1)*majorMult+(major&1), a=0, b=0;
      for(let minor=0;minor<minorCount;minor++) {
        const v=sector[12+index];index+=minorInc;if(index>=size)index-=size;
        a^=v;b^=v;a=eccForward[a];
      }
      a=eccBackward[eccForward[a]^b];
      sector[dest+major]=a;sector[dest+majorCount+major]=a^b;
    }
  }
  function repairSector(sector,dataOffset) {
    if(sector.length!==2352) return sector;
    const mode=sector[15];
    if(mode===2 && dataOffset===24) {
      if(sector[18]&0x20) throw new Error("Mode 2 Form 2 sector cannot hold stage data.");
      const sum=edc(sector,16,2056);
      sector[2072]=sum&255;sector[2073]=sum>>>8&255;sector[2074]=sum>>>16&255;sector[2075]=sum>>>24;
      const address=Uint8Array.from(sector.subarray(12,16));
      sector.fill(0,12,16);
      eccBlock(sector,86,24,2,86,2076);
      eccBlock(sector,52,43,86,88,2248);
      sector.set(address,12);
    } else if(mode===1 && dataOffset===16) {
      const sum=edc(sector,0,2064);
      sector[2064]=sum&255;sector[2065]=sum>>>8&255;sector[2066]=sum>>>16&255;sector[2067]=sum>>>24;
      sector.fill(0,2068,2076);
      eccBlock(sector,86,24,2,86,2076);
      eccBlock(sector,52,43,86,88,2248);
    } else throw new Error("Unsupported sector format for writing.");
    return sector;
  }

  async function changedSectors(disc,record,before,after) {
    if(before.length!==after.length || before.length!==record.size) throw new Error("Overlay size changed.");
    const changed=[];
    for(let chunk=0;chunk<before.length;chunk+=2048) {
      const length=Math.min(2048,before.length-chunk);
      let first=-1;
      for(let i=0;i<length;i++) if(before[chunk+i]!==after[chunk+i]) {first=i;break;}
      if(first<0)continue;
      const start=(record.extent+chunk/2048)*disc.sectorSize;
      const original=new Uint8Array(await disc.file.slice(start,start+disc.sectorSize).arrayBuffer());
      const modified=original.slice();
      modified.set(after.subarray(chunk,chunk+length),disc.dataOffset);
      if(disc.sectorSize===2352)repairSector(modified,disc.dataOffset);
      changed.push({start,original,modified});
    }
    return changed;
  }
  function modifiedBlob(file,changes) {
    const parts=[];let cursor=0;
    for(const c of changes) {
      parts.push(file.slice(cursor,c.start),c.modified);
      cursor=c.start+c.modified.length;
    }
    parts.push(file.slice(cursor));
    return new Blob(parts,{type:"application/octet-stream"});
  }
  function ppf3Blob(changes,description="SOTN Area Editor v3") {
    const head=new Uint8Array(60);
    head.set(new TextEncoder().encode("PPF30"),0);head[5]=2;
    head.fill(32,6,56);
    head.set(new TextEncoder().encode(description.slice(0,50)),6);
    head[56]=0;head[57]=0;head[58]=0;
    const parts=[head];
    for(const c of changes) {
      for(let i=0;i<c.modified.length;) {
        if(c.modified[i]===c.original[i]){i++;continue;}
        const start=i;
        while(i<c.modified.length&&c.modified[i]!==c.original[i]&&i-start<255)i++;
        const h=new Uint8Array(9),v=new DataView(h.buffer);
        v.setBigUint64(0,BigInt(c.start+start),true);h[8]=i-start;
        parts.push(h,c.modified.slice(start,i));
      }
    }
    return new Blob(parts,{type:"application/octet-stream"});
  }

  const api = {
    CLUT_INDICES, paletteOffset, decodePsxColor16, decodePalette,
    decodeStagePages, renderTileRGBA, normalizeIsoName, parseDirRecord, DiscImage,
    repairSector, changedSectors, modifiedBlob, ppf3Blob
  };
  global.SotnCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
