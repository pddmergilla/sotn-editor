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
    manager.toggleMainLoop(1);
  }
  async function save(manager,store,core){
    manager.saveSaveFiles();
    const bytes=manager.getSaveFile(false);
    if(!bytes?.length)throw new Error("The emulator did not provide a memory card; export a backup and try again.");
    const blob=new Blob([bytes]),hash=await core.fingerprint(blob);
    await store.put(KEY,{version:1,blob,hash});
    const saved=await read(store,core);
    if(!saved||await core.fingerprint(new Blob([saved]))!==hash)
      throw new Error("The memory-card write could not be verified; keep this tab open and try again.");
    await new Promise((resolve,reject)=>manager.FS.syncfs(false,error=>error?reject(error):resolve()));
  }
  root.SotnPlayCard={read,restore,save};
  if(typeof module!=="undefined")module.exports=root.SotnPlayCard;
})(typeof window!=="undefined"?window:globalThis);
