(function(root){
  "use strict";
  const VERSION="4.2.3",DISC_NAME="sotn-editor-test.cue";
  const encoder=new TextEncoder();
  function cue(sectorSize,dataOffset,audio){
    if(![2048,2352].includes(sectorSize))throw new Error("Unsupported disc sector size.");
    const mode=sectorSize===2048?"MODE1/2048":dataOffset===16?"MODE1/2352":"MODE2/2352";
    return `FILE "track1.bin" BINARY\n  TRACK 01 ${mode}\n    INDEX 01 00:00:00\n`+
      (audio?'FILE "track2.bin" BINARY\n  TRACK 02 AUDIO\n    INDEX 00 00:00:00\n    INDEX 01 00:02:00\n':"");
  }
  function archive(filename,content){
    const name=encoder.encode(filename),data=typeof content==="string"?encoder.encode(content):content;
    let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    crc=(crc^0xffffffff)>>>0;
    const local=new Uint8Array(30+name.length),central=new Uint8Array(46+name.length),end=new Uint8Array(22);
    const l=new DataView(local.buffer),c=new DataView(central.buffer),e=new DataView(end.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint32(14,crc,true);
    l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint32(16,crc,true);
    c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);central.set(name,46);
    e.setUint32(0,0x06054b50,true);e.setUint16(8,1,true);e.setUint16(10,1,true);
    e.setUint32(12,central.length,true);e.setUint32(16,local.length+data.length,true);
    return new Blob([local,data,central,end],{type:"application/zip"});
  }
  async function fingerprint(blob){
    const hashes=[];
    for(let at=0;at<blob.size;at+=4*1024*1024){
      hashes.push(await crypto.subtle.digest("SHA-256",await blob.slice(at,at+4*1024*1024).arrayBuffer()));
    }
    const digest=await crypto.subtle.digest("SHA-256",await new Blob([String(blob.size),...hashes]).arrayBuffer());
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  }
  const keyboards={
    classic:{keys:["z","a","shift","enter","up arrow","down arrow","left arrow","right arrow","x","s","q","e","w","r"],
      help:"Arrows move · Z Cross · X Circle · A Square · S Triangle · Q/E L1/R1 · W/R L2/R2 · Shift Select · Enter Start."},
    wasd:{keys:["k","j","space","enter","w","s","a","d","l","i","u","o","7","9"],
      help:"WASD move · I Triangle · J Square · K Cross · L Circle · U/7 L1/L2 · O/9 R1/R2 · Space Select · Enter Start."}
  };
  function controls(preset="classic"){
    const keys=(keyboards[preset]||keyboards.classic).keys;
    const buttons=["BUTTON_1","BUTTON_3","SELECT","START","DPAD_UP","DPAD_DOWN","DPAD_LEFT","DPAD_RIGHT","BUTTON_2","BUTTON_4","LEFT_TOP_SHOULDER","RIGHT_TOP_SHOULDER","LEFT_BOTTOM_SHOULDER","RIGHT_BOTTOM_SHOULDER"];
    return {0:Object.fromEntries(keys.map((value,i)=>[i,{value,value2:buttons[i]}])),1:{},2:{},3:{}};
  }
  function applyKeyboard(emulator,preset){
    if(!emulator?.controls?.[0])return;
    for(const [index,control] of Object.entries(controls(preset)[0])){
      emulator.gameManager.simulateInput(0,Number(index),0);
      emulator.controls[0][index]={...emulator.controls[0][index],value:control.value};
      if(emulator.defaultControllers?.[0]?.[index])emulator.defaultControllers[0][index].value=control.value;
    }
    emulator.setupKeys();
  }
  const cueArchive=text=>archive(DISC_NAME,text);
  root.SotnPlayCore={VERSION,DISC_NAME,cue,cueArchive,archive,fingerprint,keyboards,controls,applyKeyboard};
  if(typeof module!=="undefined")module.exports=root.SotnPlayCore;
})(typeof window!=="undefined"?window:globalThis);
