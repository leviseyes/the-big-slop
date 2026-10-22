import test from "node:test";
import assert from "node:assert/strict";
import {assetConflicts,mergePlanAssets} from "../services/asset-registry.mjs";
const known=[{id:"mara",kind:"character",name:"Mara",description:"Yellow uniform",imageKey:"saved.png"},{id:"diner",kind:"location",name:"Diner",description:"Red booths"}];
test("benign formatting retains canonical identity and saved image",()=>{
 const plan={assets:[{id:"mara",kind:"character",name:" MARA "}],clips:[{assetIds:["mara"]}]};
 assert.equal(assetConflicts(plan,known).length,0);assert.deepEqual(mergePlanAssets(plan,known).assets,known);
});
test("director resolves fuller names without replacing established references",()=>{
 const plan={assets:[{id:"mara",kind:"character",name:"Mara the waitress",description:"New wording"}],clips:[{assetIds:["mara"]}]};
 assert.throws(()=>mergePlanAssets(plan,known),/resolve every/);
 const result=mergePlanAssets(plan,known,[{sourceId:"mara",existingId:"mara"}]);
 assert.deepEqual(result.assets,known);assert.equal(result.clips[0].assetIds[0],"mara");
});
test("real collisions get new IDs and remapped location keys without mutating inputs",()=>{
 const plan={assets:[{id:"diner",kind:"location",name:"A different diner"}],clips:[{assetIds:["diner"],locationId:"diner",endLocationId:"diner"}]};
 const result=mergePlanAssets(plan,known,[{sourceId:"diner",existingId:null}],1);
 assert.equal(result.assets[2].id,"diner-s2-1");assert.deepEqual(result.clips[0].assetIds,["diner-s2-1"]);assert.equal(result.clips[0].locationId,"diner-s2-1");assert.equal(result.clips[0].endLocationId,"diner-s2-1");
 assert.equal(plan.clips[0].assetIds[0],"diner");assert.equal(known.length,2);
});
test("incompatible merges and unknown references fail without partially modifying registry",()=>{
 const plan={assets:[{id:"mara",kind:"object",name:"Mara statue"}],clips:[{assetIds:["mara"]}]};
 assert.throws(()=>mergePlanAssets(plan,known,[{sourceId:"mara",existingId:"mara"}]),/incompatible/);
 const result=mergePlanAssets(plan,known,[{sourceId:"mara",existingId:null}]);assert.equal(result.assets[2].kind,"object");
 assert.throws(()=>mergePlanAssets({assets:[],clips:[{assetIds:["missing"]}]},known),/unknown asset/);assert.equal(known.length,2);
});
