(() => {
  "use strict";
  let connection;
  function open(){
    if(!connection)connection=new Promise((resolve,reject)=>{
      const request=indexedDB.open("sotn-editor-play",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("files");
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error("Close other play tabs to open browser storage."));
    });
    return connection;
  }
  async function access(mode,key,value){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("files",mode==="get"?"readonly":"readwrite"),store=tx.objectStore("files");
      const request=mode==="get"?store.get(key):mode==="delete"?store.delete(key):store.put(value,key);
      tx.oncomplete=()=>resolve(request.result);
      tx.onerror=()=>reject(tx.error||request.error);
      tx.onabort=()=>reject(tx.error||new Error("Browser storage was interrupted."));
    });
  }
  window.SotnPlayStore={get:key=>access("get",key),put:(key,value)=>access("put",key,value),delete:key=>access("delete",key)};
})();
