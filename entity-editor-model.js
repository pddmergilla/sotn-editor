(() => {
  "use strict";

  function localEntityPoint(entity, zoom) {
    return {x:Number(entity.x)*zoom,y:Number(entity.y)*zoom};
  }

  function localPositionAtCanvasPoint(point, zoom) {
    if(!Number.isFinite(zoom)||zoom<=0)return null;
    return {x:Math.round(point.x/zoom),y:Math.round(point.y/zoom)};
  }

  function shouldDrawEntities(mode, displayEnabled) {
    return mode==="entities"||displayEnabled===true;
  }

  function freeEntitySlots(stage, layoutId, bankLength) {
    const index=Number(layoutId);
    if(!stage||!Array.isArray(stage.xPtrs)||!Array.isArray(stage.yPtrs)||
      !Number.isInteger(index)||index<0||index>=stage.xPtrs.length||
      !Number.isInteger(bankLength)||bankLength<0||typeof stage.banks?.get!=="function")return null;
    const xPtr=stage.xPtrs[index],yPtr=stage.yPtrs[index];
    if(!Number.isInteger(xPtr)||!Number.isInteger(yPtr))return null;
    const firstIndex=stage.xPtrs.indexOf(xPtr);
    if(firstIndex<0)return null;
    const writeYPtr=stage.yPtrs[firstIndex];
    if(stage.xPtrs.some((ptr,i)=>ptr===xPtr&&stage.yPtrs[i]!==writeYPtr))return null;
    const xBank=stage.banks.get(xPtr),yBank=stage.banks.get(writeYPtr);
    if(!Number.isInteger(xBank?.capacity)||!Number.isInteger(yBank?.capacity))return null;
    return {
      free:Math.max(0,Math.min(xBank.capacity,yBank.capacity)-bankLength),
      xCapacity:xBank.capacity,
      yCapacity:yBank.capacity
    };
  }

  const api={freeEntitySlots,localEntityPoint,localPositionAtCanvasPoint,shouldDrawEntities};
  const root=typeof window!=="undefined"?window:globalThis;
  root.SotnEntityEditorModel=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();
