const assert = require("assert");
const T = require("../entity-templates.js");
const C = require("../entity-catalog.js");

const marker = (x, y) => ({x, y, id:0, flags:0, slot:0, spawnId:0, params:0});
const skeleton = {x:24, y:48, id:62, flags:0xA0, slot:4, spawnId:7, params:3};
const archer = {x:80, y:48, id:68, flags:0, slot:5, spawnId:0, params:2};
const item = {x:32, y:32, id:12, flags:0, slot:6, spawnId:0, params:1};
const stage = {
  rooms:[
    {entityLayoutId:0, entityGfxId:3},
    {entityLayoutId:1, entityGfxId:3},
    {entityLayoutId:2, entityGfxId:4}
  ],
  entityLayouts:{indices:[0,1,2], entities:[
    [marker(-2,-2),skeleton,marker(-1,-1)],
    [marker(-2,-2),archer,item,marker(-1,-1)],
    [marker(-2,-2),{...archer,slot:8},marker(-1,-1)]
  ]},
  originalEntities:[
    [marker(-2,-2),{...skeleton},marker(-1,-1)],
    [marker(-2,-2),{...archer},{...item},marker(-1,-1)],
    [marker(-2,-2),{...archer,slot:8},marker(-1,-1)]
  ]
};

const choices=T.templates(stage,0,"NO1",C);
assert(choices.some(choice=>choice.type.name==="Skeleton"));
assert(choices.some(choice=>choice.type.name==="Bone Archer"));
assert(choices.some(choice=>choice.type.name==="Persistent Item Drop"));
assert.equal(T.templates(stage,2,"NO1",C).some(choice=>choice.type.name==="Skeleton"),false);
const donorChoices=T.templates(stage,2,"NO1",C,0);
assert(donorChoices.some(choice=>choice.type.name==="Skeleton"));
assert.equal(donorChoices.some(choice=>choice.type.name==="Bone Archer"),false);
assert(donorChoices.every(choice=>choice.sourceRoomIndex===0));
const skeletonChoice=choices.find(choice=>choice.entity.id===62);
const added=T.makeEntity(stage,skeletonChoice,100,120);
assert.deepEqual(added,{x:100,y:120,id:62,flags:0xA0,slot:1,spawnId:1,params:3});
assert.equal(skeleton.slot,4);
assert.equal(skeleton.spawnId,7);
const changed=T.changeType(stage,item,skeletonChoice);
assert.equal(changed.id,62);
assert.equal(changed.flags,0xA0);
assert.equal(changed.params,3);
assert.equal(changed.slot,6);
assert.equal(changed.spawnId,1);
assert.equal(changed.x,32);
stage.entityLayouts.entities[0].splice(2,0,added);
assert.equal(T.freeSlot(stage),2);
assert.equal(T.freePersistenceIndex(stage),2);
console.log("Entity template tests passed.");
