const assert=require("assert");
const C=require("../entity-catalog.js");
const M=require("../entity-editor-model.js");

const nz0=[1,35,55].map(id=>C.typeFor("NZ0",id));
assert.deepEqual(nz0.map(type=>type.symbol),[
  "E_BREAKABLE",
  "E_RED_EYE_BUST",
  "E_RELIC_CONTAINER"
]);
assert.equal(nz0[0].label,"Breakable (1 / 0x01)");
assert.equal(nz0[1].label,"Red Eye Bust (35 / 0x23)");
assert.equal(nz0[2].label,"Relic Container (55 / 0x37)");

assert.equal(C.typeFor("CEN",0x80).symbol,"E_BREAKABLE_DEBRIS");
assert.equal(C.typeFor("LIB",0x06).symbol,"E_INTENSE_EXPLOSION");
assert.equal(C.typeFor("LIB",0x11).symbol,"E_ID_11");
assert.equal(C.typeFor("CHI",0x2D).symbol,"E_VENUS_WEED_SPIKE");
assert.ok(C.areaTypes("RARE"));
assert.equal(C.typeFor("SEL",0x23).name,"Undocumented ID");
assert.equal(C.typeFor("NZ0",0xFF).name,"Not listed in area enum");

const prizeChoices=C.getParamItemChoices("NZ0","E_PRIZE_DROP");
assert.equal(prizeChoices.find(choice=>choice.param===0x00).symbol,"ITEMDROP_SMALL_HEART");
assert.equal(prizeChoices.find(choice=>choice.param===0x0A).symbol,"ITEMDROP_GOLD_9");
assert.equal(prizeChoices.find(choice=>choice.param===0x0E).symbol,"ITEMDROP_SUBWEAPON_1");
assert.equal(prizeChoices.find(choice=>choice.param===0x17).symbol,"ITEMDROP_LIFE_VESSEL");
assert.ok(prizeChoices.find(choice=>choice.param===0x0E).label.includes("14 / 0x0E"));
assert.equal(C.getParamItemChoices("ST0","E_PRIZE_DROP").some(choice=>choice.param===0x17),false);

const equipment=C.getParamItemChoices("NZ0","E_EQUIP_ITEM_DROP");
assert.equal(equipment.find(choice=>choice.param===0).symbol,"ITEMDROP_EMPTY_HAND");
assert.equal(equipment.find(choice=>choice.param===0xA9).symbol,"ITEMDROP_NO_ARMOR");
assert.equal(equipment.find(choice=>choice.param===0x102).symbol,"ITEMDROP_ALUCART_MAIL");
assert.equal(C.getParamItemChoices("NZ0","E_PERSISTENT_ITEM_DROP"),null);
assert.match(C.paramHint("E_PERSISTENT_ITEM_DROP"),/stage-local PrizeDrops index/);

const canvasPoint=M.localEntityPoint({x:72,y:132},1);
assert.deepEqual(canvasPoint,{x:72,y:132});
assert.deepEqual(M.localEntityPoint({x:72,y:132},0.5),{x:36,y:66});
assert.deepEqual(M.localPositionAtCanvasPoint({x:36,y:66},0.5),{x:72,y:132});
assert.equal(M.shouldDrawEntities("entities",false),true);
assert.equal(M.shouldDrawEntities("tiles",false),false);

const stage={
  xPtrs:[100,101],
  yPtrs:[200,201],
  banks:new Map([
    [100,{capacity:10}],
    [101,{capacity:6}],
    [200,{capacity:8}],
    [201,{capacity:5}]
  ])
};
assert.equal(M.freeEntitySlots(stage,1,4).free,1);
assert.equal(M.freeEntitySlots(stage,0,8).free,0);
assert.equal(M.freeEntitySlots({...stage,banks:new Map()},0,1),null);
assert.equal(M.freeEntitySlots({
  xPtrs:[100,100],yPtrs:[200,201],banks:stage.banks
},0,1),null);

console.log("Entity editor model and catalog tests passed.");
