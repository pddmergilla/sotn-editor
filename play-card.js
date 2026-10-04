(function(root){
  "use strict";
  const KEY="memoryCard";
  async function read(store,core){
    const card=await store.get(KEY);
    if(card===undefined||card===null)return null;
    if(card.version!==1||!(card.blob instanceof Blob)||!card.blob.size||card.blob.size>1024*1024||await core.fingerprint(card.blob)!==card.hash)
      throw new Error("The saved memory card is damaged; browser play is stopped to protect it.");
    return new Uint8Array(await card.blob.arrayBuffer());
  }
  function restore(manager,bytes){
    if(!bytes)return;
    manager.toggleMainLoop(0);
    manager.writeFile(manager.getSaveFilePath(),bytes);
    manager.loadSaveFiles();
    const restored=capture(manager);
    if(restored.length!==bytes.length||restored.some((value,index)=>value!==bytes[index]))
      throw new Error("The emulator did not restore the memory card; keep your downloaded file and try again.");
    manager.toggleMainLoop(1);
  }
  function capture(manager){
    manager.saveSaveFiles();
    const bytes=manager.getSaveFile(false);
    if(!bytes?.length)throw new Error("The emulator did not provide a memory card; export a backup and try again.");
    return new Uint8Array(bytes).slice();
  }
  async function importFile(file){
    if(![131072,262144].includes(file.size))throw new Error("Choose a raw PS1 memory card (.srm or .mcr), 128 KB or 256 KB; savestates cannot be used here.");
    const bytes=new Uint8Array(await file.arrayBuffer());
    for(let offset=0;offset<bytes.length;offset+=131072){
      if(bytes[offset]!==77||bytes[offset+1]!==67)throw new Error("This file is not a raw PS1 memory card; choose a card downloaded by this player.");
    }
    return bytes;
  }
  async function persist(manager,bytes,store,core){
    const blob=new Blob([bytes]),hash=await core.fingerprint(blob);
    await store.put(KEY,{version:1,blob,hash});
    const saved=await read(store,core);
    if(!saved||await core.fingerprint(new Blob([saved]))!==hash)
      throw new Error("The memory-card write could not be verified; keep this tab open and try again.");
    await new Promise((resolve,reject)=>manager.FS.syncfs(false,error=>error?reject(error):resolve()));
  }
  async function save(manager,store,core){await persist(manager,capture(manager),store,core);}
  root.SotnPlayCard={read,restore,capture,importFile,persist,save};
  if(typeof module!=="undefined")module.exports=root.SotnPlayCard;
})(typeof window!=="undefined"?window:globalThis);
