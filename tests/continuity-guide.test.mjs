import test from "node:test";
import assert from "node:assert/strict";
import { prepareContinuityGuide, validContinuityGuide, canResumeContinuityPlanning } from "../services/production-direction.mjs";

test("later sections reuse the saved guide without another director call or lost work", async () => {
  for (const incoming of ["x".repeat(5923), "Different wardrobe and voices", "", null]) {
    const p = {productionBible:"Established cast, wardrobe and voices", pendingPlan:{plan:{productionBible:incoming,clips:[{id:"c2"}],assets:[{id:"actor"}]}},clips:[{id:"c1"}]};
    const before = structuredClone(p);
    await prepareContinuityGuide(p,{repair:()=>assert.fail("unnecessary paid call"),checkpoint:async()=>{}});
    assert.equal(p.pendingPlan.plan.productionBible,before.productionBible);
    assert.deepEqual(p.clips,before.clips);
    assert.deepEqual(p.pendingPlan.plan.clips,before.pendingPlan.plan.clips);
    assert.deepEqual(p.pendingPlan.plan.assets,before.pendingPlan.plan.assets);
  }
});

test("invalid first guide is repaired, retaining original and checkpoints", async () => {
  const original = "x".repeat(5923), p={pendingPlan:{plan:{productionBible:original}}};
  let calls=0, checkpoints=0;
  await prepareContinuityGuide(p,{checkpoint:async()=>checkpoints++,repair:async(source,attempt)=>{
    assert.equal(source,original);assert.equal(attempt,calls++);return attempt===0 ? " " : "Consistent daylight and wardrobe";
  }});
  assert.equal(p.productionBible,p.pendingPlan.plan.productionBible);
  assert.equal(p.pendingPlan.continuityRepair.original,original);
  assert.equal(calls,2);assert.ok(checkpoints>=4);
});

test("repairs are bounded and interruption preserves attempt identity",async()=>{
  const p={pendingPlan:{plan:{productionBible:""}}};
  const checkpoint=async()=>{};
  await assert.rejects(prepareContinuityGuide(p,{checkpoint,repair:async()=>{throw new Error("connection interrupted")}}),/interrupted/);
  assert.equal(p.pendingPlan.continuityRepair.attempts,0);
  let calls=0;
  const repair=async()=>{calls++;return "x".repeat(5001)};
  await assert.rejects(prepareContinuityGuide(p,{checkpoint,repair}),/could not be finalized/);
  await assert.rejects(prepareContinuityGuide(p,{checkpoint,repair}),/could not be finalized/);
  assert.equal(calls,2);
  for(const v of [null,{},[],42," ","x".repeat(5001)]) assert.equal(validContinuityGuide(v),false);
});

test("operator recovery requires exact paused planning state and preserves approval gates",()=>{
  const p={status:"failed",error:"The director must provide a concise continuity guide.",workStage:"planning",planChunks:1,pendingPlan:{section:1,plan:{}},productionBible:"Original guide",clips:[],assets:[]};
  assert.equal(canResumeContinuityPlanning(p),true);
  for(const change of [{status:"planning"},{error:"other"},{pendingPlan:null},{pendingPlan:{section:2,plan:{}}},{productionBible:""},{runtimeApprovedAt:1},{paidAt:1},{generationAuthorization:{}},{assets:[{imageKey:"saved"}]},{clips:[{requestId:"submitted"}]}])
    assert.equal(!!canResumeContinuityPlanning({...p,...change}),false);
});
