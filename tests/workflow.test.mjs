import test from "node:test";
import assert from "node:assert/strict";
import { planningSections, targetClipCount, reviseReference, currentProgress, stageEstimates } from "../services/production-workflow.mjs";
test("five minutes always allocates ten clips regardless of paragraph count",()=>{
  const script=Array.from({length:40},(_,i)=>`Scene ${i}: A person crosses the room and looks out of the window.`).join("\n\n");
  const sections=planningSections(script,5);
  assert.equal(sections.reduce((sum,s)=>sum+s.clipCount,0),10);
  const blocks=sections.flatMap(s=>s.blocks);
  assert.equal(new Set(blocks.map(b=>b.id)).size,blocks.length);
  assert.equal(blocks.map(b=>b.text).join(" "),script.replace(/\s+/g," "));
});
test("large scripts preserve all blocks when fewer clips than planning sections are requested",()=>{
  const script=Array.from({length:6000},(_,i)=>`word${i}`).join(" ");
  const sections=planningSections(script,1);
  assert.equal(sections.reduce((sum,s)=>sum+s.clipCount,0),2);
  assert.equal(sections.flatMap(s=>s.blocks).map(b=>b.text).join(" "),script);
  for(const minutes of [0,0.7,361,NaN])assert.throws(()=>targetClipCount(minutes));
});
test("reference edits preserve unrelated images and invalidate only dependent frames and quote",()=>{
  const p={status:"ready",assets:[{id:"a",name:"A",imageKey:"a-v0.png",referenceUrl:"old",recovery:{}},{id:"b",name:"B",imageKey:"b.png"}],clips:[{id:"c1",assetIds:["a"],frameKey:"f1",frameUrl:"u1",input:{},recovery:{frame:{attempts:[{}]}}},{id:"c2",assetIds:["b"],frameKey:"f2",frameUrl:"u2"}],quote:{id:"old"},consent:{},generationAuthorization:undefined};
  const next=reviseReference(p,"a","Blue coat, same face");
  assert.equal(next.assets[0].editSourceKey,"a-v0.png");assert.equal(next.assets[0].imageKey,undefined);assert.equal(next.assets[0].revision,1);
  assert.deepEqual(next.assets[1],p.assets[1]);assert.deepEqual(next.clips[1],p.clips[1]);
  assert.equal(next.clips[0].frameKey,undefined);assert.equal(next.clips[0].recovery.frame,undefined);assert.equal(next.clips[0].frameRevision,1);
  assert.equal(next.quote,undefined);assert.equal(p.assets[0].imageKey,"a-v0.png");
});
test("legacy scene-frame progress reflects completed work, with remaining time for each step",()=>{
  const p={status:"preparing",assets:[{imageKey:"a",referenceUrl:"u"}],clips:Array.from({length:40},(_,i)=>i<8?{frameUrl:"f"}:{})};
  const progress=currentProgress(p);
  assert.equal(progress.key,"frames");assert.equal(progress.done,8);assert.equal(progress.total,40);
  assert.equal(progress.remainingLow,32);assert.equal(progress.remainingHigh,128);
  assert.equal(stageEstimates(p).length,6);
});
test("batch reference edits invalidate shared frames once and reject invalid batches atomically",async()=>{
 const {reviseReferences}=await import("../services/production-workflow.mjs");
 const p={status:"ready",assets:[{id:"a",name:"A",imageKey:"a.png"},{id:"b",name:"B",imageKey:"b.png"},{id:"c",name:"C",imageKey:"c.png"}],clips:[{id:"shared",assetIds:["a","b"],frameKey:"shared.png",frameRevision:2},{id:"other",assetIds:["c"],frameKey:"other.png"}],quote:{id:"q"}};
 const next=reviseReferences(p,[{assetId:"a",changes:"Blue jacket"},{assetId:"b",changes:"Red table"}]);
 assert.equal(next.assets[0].editInstructions,"Blue jacket");assert.equal(next.assets[1].editInstructions,"Red table");
 assert.equal(next.assets[0].editSourceKey,"a.png");assert.equal(next.assets[1].editSourceKey,"b.png");
 assert.equal(next.clips[0].frameRevision,3);assert.equal(next.clips[0].frameKey,undefined);assert.deepEqual(next.clips[1],p.clips[1]);assert.deepEqual(next.assets[2],p.assets[2]);assert.equal(next.quote,undefined);
 for(const edits of [[],[{assetId:"a",changes:"Blue"},{assetId:"a",changes:"Red"}],[{assetId:"a",changes:"Blue"},{assetId:"missing",changes:"Red"}],[{assetId:"a",changes:""}]])assert.throws(()=>reviseReferences(p,edits));
 assert.equal(p.assets[0].imageKey,"a.png");assert.equal(p.clips[0].frameRevision,2);assert.equal(p.quote.id,"q");
});
