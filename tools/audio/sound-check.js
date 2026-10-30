// Read-only sound checker.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {DiscImage} = require('../../sotn-core');
const ROOT = path.resolve(__dirname, '../..');
const DECOMP = process.env.SOTN_DECOMP || path.resolve(ROOT, '../sotn-decomp');
const IMAGE = process.env.SOTN_BIN || path.join(ROOT, 'MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const clamp = n => Math.max(-32768, Math.min(32767, n));
const areaBlock=fs.readFileSync(path.join(ROOT,'app.js'),'utf8').match(/const AREA_NAMES=\{([\s\S]*?)\n  \};/)?.[1]||'';
const areaNames=Object.fromEntries([...areaBlock.matchAll(/(\w+):"([^"]+)"/g)].map(m=>[m[1],m[2]]));

function sourceCatalog() {
  const names = new Map(), uses = new Map();
  const header = fs.readFileSync(path.join(DECOMP, 'include/sfx.h'), 'utf8');
  for (const line of header.split(/\r?\n/)) {
    const m = line.match(/\/\*\s*(?:us:)?(0x[\dA-Fa-f]+)[^*]*\*\/\s*(\w+)[^/]*(?:\/\/\s*(.*))?/);
    if (m) names.set(Number(m[1]), {name:m[2], description:m[3] || ''});
  }
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
      const p = path.join(dir,e.name);
      if (e.isDirectory()) { if (!/saturn|psp$/.test(e.name)) walk(p); }
      else if (/\.[ch]$/.test(e.name)) {
        const lines = fs.readFileSync(p,'utf8').split(/\r?\n/);
        lines.forEach((s,i) => {
          for (const m of s.matchAll(/\bSFX_[A-Z0-9_]+\b/g)) {
            const list = uses.get(m[0]) || [];
            const file=path.relative(DECOMP,p).replaceAll('\\','/'),stage=file.match(/^src\/(?:st|boss)\/([^/]+)/)?.[1]?.toUpperCase();
            list.push({file, line:i+1, where:areaNames[stage]||file.replace(/^src\//,'').replace(/\.[ch]$/,'').replaceAll('_',' '),text:s.trim()});
            uses.set(m[0],list);
          }
        });
      }
    }
  }
  walk(path.join(DECOMP,'src')); walk(path.join(DECOMP,'mods/mariapsp-forpsx'));
  return {names,uses};
}

function parseBank(vh, vb, info) {
  if (vh.toString('ascii',0,4) !== 'pBAV') throw new Error(`Invalid sound bank: ${info.name}`);
  const count = vh.readUInt16LE(18), n = vh.readUInt16LE(22);
  const table = 0x820 + count * 512;
  if (table + 512 > vh.length || count > 128 || n > 254) throw new Error(`Broken bank header: ${info.name}`);
  const scale = vh.readUInt32LE(4) >= 5 ? 8 : 4;
  let off = vh.readUInt16LE(table) * scale;
  const samples = [null];
  for (let i=1;i<=n;i++) {
    const size = vh.readUInt16LE(table+i*2)*scale;
    if (off+size > vb.length || size%16) throw new Error(`Sample exceeds bank: ${info.name}/${i}`);
    samples.push({index:i, offset:off, size}); off += size;
  }
  const programs = new Map(); let packed = 0;
  for (let p=0;p<128;p++) {
    const at = 32+p*16, tones = vh[at];
    if (!tones) continue;
    if (tones>16 || packed>=count) throw new Error(`Invalid tone count: ${info.name}`);
    const list=[];
    for(let t=0;t<tones;t++) {
      const a=0x820+packed*512+t*32;
      list.push({tone:t, volume:vh[a+2], pan:vh[a+3], center:vh[a+4], fine:vh[a+5],
        adsr1:vh.readUInt16LE(a+16), adsr2:vh.readUInt16LE(a+18), sample:vh.readUInt16LE(a+22)});
    }
    programs.set(p,{volume:vh[at+1],pan:vh[at+4],tones:list}); packed++;
  }
  const area=info.name.match(/^(?:ST|BOSS)\/([^/]+)/)?.[1];
  return {...info,location:areaNames[area]||'',vh,vb,samples,programs,volume:vh[24]};
}

function decodeADPCM(bytes) {
  const out=[], filters=[[0,0],[60,0],[115,-52],[98,-55],[122,-60]];
  let h1=0,h2=0,loopStart=0,loopEnd=0;
  for(let a=0;a+16<=bytes.length;a+=16) {
    const shift=bytes[a]&15, filter=bytes[a]>>4, flags=bytes[a+1];
    if(filter>4 || shift>12) throw new Error('Invalid PlayStation sample block.');
    if(flags&4)loopStart=out.length;
    const [f1,f2]=filters[filter];
    for(let i=0;i<28;i++) {
      let v=(bytes[a+2+(i>>1)]>>((i&1)*4))&15;
      if(v&8)v-=16;
      v=clamp(((v<<12)>>shift)+((h1*f1+h2*f2+32)>>6));
      out.push(v);h2=h1;h1=v;
    }
    if(flags&1) {if(flags&2)loopEnd=out.length;break;}
  }
  return {pcm:Float32Array.from(out,v=>v/32768),loopStart,loopEnd};
}

function wav(channels, rate=44100) {
  const length=channels[0].length, b=Buffer.alloc(44+length*channels.length*2);
  b.write('RIFF'); b.writeUInt32LE(b.length-8,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(channels.length,22); b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*channels.length*2,28); b.writeUInt16LE(channels.length*2,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(b.length-44,40);
  for(let i=0;i<length;i++)for(let c=0;c<channels.length;c++)b.writeInt16LE(clamp(Math.round(channels[c][i]*32767)),44+(i*channels.length+c)*2);
  return b;
}

async function load() {
  const disc=await DiscImage.open(await fs.openAsBlob(IMAGE));
  const files=[];
  async function walk(r,p='') {for(const x of await disc.readDirectory(r)) {
    const name=p+x.name.replace(/;\d+$/,'');
    if(x.isDirectory)await walk(x,name+'/');else files.push({...x,path:name});
  }}
  await walk(disc.root);
  const find = p => {const r=files.find(x=>x.path===p);if(!r)throw new Error(`Missing disc file: ${p}`);return r;};
  const read = async r=>Buffer.from(await disc.readFile(r));
  const draRec=find('DRA.BIN'), dra=await read(draRec);
  if(dra.length<0x21ecc || dra.toString('ascii',0x1107c,0x11080)!=='pBAV')throw new Error('Expected the US PS1 DRA layout.');
  const rawOffset=(lba,off=0)=>(lba+Math.floor(off/2048))*disc.sectorSize+disc.dataOffset+off%2048;
  const banks=[], warnings=[];
  function add(vh,vb,name,slot,hlba,hoff,blba,boff,spu) {
    banks.push(parseBank(vh,vb,{id:banks.length,name,slot,headerBIN:rawOffset(hlba,hoff),
      bodyLBA:blba,bodyOffset:boff,spu}));
  }
  const headers=[0x1107c,0x1407c,0x1607c,0x1807c];
  const bodies=[0x9b6a0,0xdd350,0xeb4e0,0x109c80];
  const bodyEnds=[0xdd350,0xeb4e0,0x105af0,0x119870];
  const spu=Array.from({length:4},(_,i)=>dra.readUInt32LE(0x1d1c8+i*4));
  for(let i=0;i<4;i++)add(dra.subarray(headers[i],headers[i]+0x3000),dra.subarray(bodies[i],bodyEnds[i]),
    ['Common effects','Alucard / native player','Native bank 2','Native bank 3'][i],i,draRec.extent,headers[i],draRec.extent,bodies[i],spu[i]);
  for(const h of files.filter(x=>x.path.endsWith('.VH'))) {
    const v=files.find(x=>x.path===h.path.slice(0,-3)+'.VB');if(!v)continue;
    const slot=h.path.startsWith('SERVANT/')?2:h.path.startsWith('VAB/')?1:3;
    try {add(await read(h),await read(v),h.path.replace('.VH',''),slot,h.extent,0,v.extent,0,spu[slot]);}
    catch(e) {warnings.push(e.message+'; this directory entry may have been repurposed by the mod.');}
  }
  const mad=await read(find('ST/MAD/MAD.BIN'));
  const hlba=mad.readUInt32LE(0x18334), blba=mad.readUInt32LE(0x18344);
  const hv=Buffer.from(await disc.readUserData(hlba,mad.readUInt32LE(0x1833c)));
  const bv=Buffer.from(await disc.readUserData(blba,mad.readUInt32LE(0x1834c)));
  add(hv,bv,'Maria playable voice (live loader)',1,hlba,0,blba,0,spu[1]);
  const mariaBank=banks.at(-1).id, catalog=sourceCatalog();
  const samples=banks.flatMap(b=>b.samples.filter(Boolean).map(s=>({bank:b.id,bankName:b.name,slot:b.slot,
    sample:s.index,size:s.size,rate:Math.round(44100*2**((60-([...b.programs.values()].flatMap(p=>p.tones).find(t=>t.sample===s.index)?.center||60))/12)),bin:hex(rawOffset(b.bodyLBA,b.bodyOffset+s.offset)),
    spu:hex(b.spu+s.offset),spuNote:'SPU address when this bank occupies its usual slot; other loading arrangements can differ.'})));
  const pcmCache=new Map();
  function decoded(b,s) {const key=b.id+':'+s.index;if(!pcmCache.has(key))pcmCache.set(key,decodeADPCM(b.vb.subarray(s.offset,s.offset+s.size)));return pcmCache.get(key);}
  function config(id,mode) {
    const off=0x1f554+(id-0x600)*7;
    if(!Number.isInteger(id)||id<0x600||id>0x8e0)throw new Error('Sound ID must be 0x600–0x8E0.');
    return Array.from(dra.subarray(off,off+7));
  }
  function events(id,mode) {
    const [vab,prog,note,volume,,tone]=config(id,mode);
    if(vab!==9)return [{vab,prog,note,volume,tone,time:0}];
    const ptr=dra.readUInt32LE(0x21ecc+(prog+1)*4), offset=ptr-0x800a0000;
    if(offset<0x2097c || offset>=0x21ecc)throw new Error('Sound script pointer is outside its known area.');
    const list=[];let time=0,ended=false;
    for(let a=offset;a+6<=0x21ecc;a+=6) {
      if(dra[a]===255){ended=true;break;}
      list.push({vab:dra[a],prog:dra[a+1],note:dra[a+2],tone:dra[a+3],volume:volume*dra[a+4]/127,time});
      time+=(dra[a+5]+1)/60;
    }
    if(!ended)throw new Error('Unterminated sound script.');return list;
  }
  function bankFor(slot,q) {
    if(slot===0)return banks[0];
    if(slot===1)return banks[q.get('mode')==='maria'?mariaBank:q.get('mode')==='richter'?banks.find(x=>x.name==='VAB/SD_RIH').id:1];
    const selected=Number(q.get(slot===2?'familiar':'stage') || slot);
    const b=banks[selected];if(!b || b.slot!==slot)throw new Error(`Choose a bank for slot ${slot}.`);return b;
  }
  function voices(id,q) {
    return events(id,q.get('mode')).flatMap(e=> {
      const b=bankFor(e.vab,q),p=b.programs.get(e.prog);
      if(!p)throw new Error(`${b.name} has no program ${e.prog}. Try another bank.`);
      const pair=p.tones.slice(e.tone,e.tone+2);
      if(!pair.length)throw new Error(`${b.name} has no tone ${e.tone}. Try another bank.`);
      return pair.filter(t=>t.sample && b.samples[t.sample]).map(t=>({b,p,t,e,s:b.samples[t.sample]}));
    });
  }
  function sound(id,q) {
    const vs=voices(id,q);if(!vs.length)throw new Error('This slot contains no sample in the selected banks.');
    const length=44100*8, left=new Float32Array(length),right=new Float32Array(length);let end=0;
    for(const {b,p,t,e,s} of vs) {
      const d=decoded(b,s),speed=2**((e.note-t.center+t.fine/128)/12);
      const frames=Math.min(length-Math.round(e.time*44100),Math.ceil(d.pcm.length/speed));
      const gain=(e.volume/127)*(p.volume/127)*(t.volume/127)*(b.volume/127)*0.45;
      const pan=Math.max(0,Math.min(127,t.pan+p.pan-64))/127;
      const start=Math.round(e.time*44100);
      for(let i=0;i<frames;i++) {
        const at=i*speed,j=Math.floor(at),f=at-j;
        const v=((d.pcm[j]||0)*(1-f)+(d.pcm[j+1]||0)*f)*gain;
        left[start+i]+=v*Math.min(1,2*(1-pan));right[start+i]+=v*Math.min(1,2*pan);
      }
      end=Math.max(end,start+frames);
    }
    return wav([left.subarray(0,end),right.subarray(0,end)]);
  }
  function rows(q) {
    return Array.from({length:737},(_,i)=> {
      const id=0x600+i, meta=catalog.names.get(id)||{name:'UNNAMED SLOT',description:''};
      const refs=catalog.uses.get(meta.name)||[];
      let available=true,reason='',refsToSamples=[];
      try {refsToSamples=voices(id,q).map(({b,s})=>({bank:b.name,sample:s.index,
        bin:hex(rawOffset(b.bodyLBA,b.bodyOffset+s.offset)),spu:hex(b.spu+s.offset)}));if(!refsToSamples.length){available=false;reason='No sample in these banks.';}}
      catch(e){available=false;reason=e.message;}
      return {id:hex(id),name:meta.name,
        originalName:meta.name,description:meta.description,ram:hex(0x800bf554+i*7),
        bin:hex(rawOffset(draRec.extent,0x1f554+i*7)),config:config(id,q.get('mode')),
        mapping:q.get('mode')==='maria'?'BIN table settings auditioned against Maria’s bank. This is a bank preview, not her current runtime action mapping.':'Settings read from this BIN; names and call sites describe source references, not a verified live action map.',
        available,reason,samples:refsToSamples,uses:refs};
    });
  }
  return {disc,banks,samples,rows,sound,decoded,rawOffset,mariaBank,warnings,source:DECOMP,image:IMAGE,
    imageSize:fs.statSync(IMAGE).size,hash:await new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');fs.createReadStream(IMAGE).on('data',b=>h.update(b)).on('end',()=>resolve(h.digest('hex'))).on('error',reject);})};
}

async function main() {
  const data=await load(), port=Number(process.env.SOTN_SOUND_PORT)||8766;
  const server=http.createServer((req,res)=> {
    try {
      const u=new URL(req.url,'http://127.0.0.1'),q=u.searchParams;
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      if(req.method!=='GET') {res.writeHead(405);res.end();return;}
      let body,type='application/json';
      if(u.pathname==='/') {type='text/html; charset=utf-8';body=fs.readFileSync(path.join(__dirname,'sound-check.html'));}
      else if(u.pathname==='/api/catalog')body=JSON.stringify({image:data.image,imageSize:data.imageSize,hash:data.hash,
        source:data.source,mariaBank:data.mariaBank,warnings:data.warnings,banks:data.banks.map(({id,name,location,slot,headerBIN,samples})=>({id,name,location,slot,headerBIN:hex(headerBIN),samples:samples.length-1})),rows:data.rows(q),samples:data.samples});
      else if(u.pathname==='/api/catalog.csv') {
        const raw=q.get('view')==='samples',rows=raw?data.samples:data.rows(q);
        const columns=raw?['bankName','sample','slot','bin','spu','size','rate']:['id','name','description','ram','bin','mapping','config','samples','uses'];
        const quote=x=>'"'+String(typeof x==='object'?JSON.stringify(x):x??'').replaceAll('"','""')+'"';
        type='text/csv; charset=utf-8';res.setHeader('Content-Disposition',`attachment; filename="SotN-${raw?'samples':'SFX'}-catalog.csv"`);
        body='\uFEFF'+[columns.map(quote).join(','),...rows.map(r=>columns.map(k=>quote(r[k])).join(','))].join('\r\n');
      }
      else if(u.pathname==='/api/sound') {type='audio/wav';body=data.sound(Number(q.get('id')),q);}
      else if(u.pathname==='/api/sample') {
        const b=data.banks[Number(q.get('bank'))],s=b?.samples[Number(q.get('sample'))];
        if(!s)throw new Error('Sample not found.');
        const rate=Number(q.get('rate')||44100);if(!Number.isFinite(rate)||rate<4000||rate>48000)throw new Error('Sample rate must be 4000–48000 Hz.');
        type='audio/wav';body=wav([data.decoded(b,s).pcm],Math.round(rate));
      }
      else if(u.pathname==='/api/source') {
        const file=q.get('file')||'',target=path.resolve(DECOMP,file);
        if(!target.startsWith(DECOMP+path.sep)||! /\.[ch]$/.test(target))throw new Error('Source path rejected.');
        type='text/plain; charset=utf-8';body=fs.readFileSync(target);
      }
      else {res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':type});res.end(body);
    } catch(e) {res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end(e.message);}
  });
  server.listen(port,'127.0.0.1',()=> {
    const url=`http://127.0.0.1:${port}`;
    console.log(`Sound Check: ${url}\n${data.samples.length} samples in ${data.banks.length} banks.\nBIN opened read-only. Keep this window open.`);
    if(process.argv.includes('--open'))execFile('cmd.exe',['/c','start','',url],{windowsHide:true},()=>{});
  });
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is busy. Open the existing checker or set SOTN_SOUND_PORT.`:e.message);process.exitCode=1;});
}
module.exports={parseBank,decodeADPCM,wav,load};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
