// Local D1 integration test. Synthetic prepared projects never call an AI provider.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import path from "node:path";
process.loadEnvFile(".env");
import {base,login as ownerLogin} from './self-host-login.mjs';
const login = await ownerLogin();
const cookie = login.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
assert.ok(cookie);
const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
let db;
for (const name of readdirSync(dir).filter(
  (n) => n.endsWith(".sqlite") && n !== "metadata.sqlite",
)) {
  const candidate = new DatabaseSync(path.join(dir, name));
  if (
    candidate
      .prepare("SELECT name FROM sqlite_master WHERE name='productions'")
      .get()
  ) {
    db = candidate;
    break;
  }
  candidate.close();
}
assert.ok(db, "local production database missing");
db.exec("PRAGMA busy_timeout=5000");
const fixtures = [];
async function post(action, data = {}) {
  const r = await fetch(base + "/api/studio", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action, ...data }),
  });
  return { status: r.status, body: await r.json() };
}
async function worker(data) {
  const r = await fetch(base + "/api/worker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WORKER_SECRET}`,
    },
    body: JSON.stringify(data),
  });
  return { status: r.status, body: await r.json() };
}
function heartbeat(value = Date.now()) {
  db.prepare(
    "INSERT INTO runtime(key,value) VALUES('worker_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(String(value));
}
try {
  heartbeat();
  const saved=await post("save",{title:"Runtime workflow fixture",format:"Short film",style:"Cinematic",script:"An adult opens a window and watches the sunlight cross the room.",targetMinutes:5});
  assert.equal(saved.status,200);const id=saved.body.project.id;fixtures.push(id);
  assert.equal(saved.body.project.dialogueLanguage,"English");
  assert.equal((await post("save",{...saved.body.project,dialogueLanguages:["unsupported"]})).status,400);
  assert.equal((await post("save",{...saved.body.project,dialogueLanguages:["English","Spanish"],textLanguages:["Hebrew"],languageNotes:"Eli speaks Spanish",resolution:"480p"})).body.project.resolution,"480p");
  assert.equal((await post("save",{...saved.body.project,resolution:"1080p"})).status,400);
  const started=await post("prepare",{id});assert.equal(started.status,200,JSON.stringify(started));assert.equal(started.body.project.status,"planning");
  assert.equal((await worker({action:"claim"})).body.job,null,"old worker cannot claim new workflow");
  assert.equal((await worker({action:"claim",workflowVersion:2})).body.job,null,"previous worker cannot claim continuity workflow");
  const claim=await worker({action:"claim",workflowVersion:3});assert.equal(claim.body.project.id,id);
  const cred={jobId:claim.body.job.id,lease:claim.body.job.lease};
  const plan={...claim.body.project,status:"planned",planId:crypto.randomUUID(),planChunks:1,assets:[{id:"a",name:"A",kind:"character",description:"Adult",prompt:"Adult"},{id:"b",name:"B",kind:"location",description:"Room",prompt:"Room"}],clips:Array.from({length:10},(_,i)=>({id:`clip-${i+1}`,assetIds:[i===0?"a":"b"],prompt:"A quiet scene",status:"planned"}))};
  assert.equal((await worker({action:"finish",...cred,project:{...plan,status:"ready"}})).status,409,"image stage requires runtime approval");
  assert.equal((await worker({action:"finish",...cred,project:{...plan,clips:[...plan.clips,plan.clips[0]]}})).status,409,"runtime count enforced by server");
  assert.equal((await worker({action:"finish",...cred,project:{...plan,dialogueLanguage:"Japanese",dialogueLanguages:["Japanese"],textLanguages:[],resolution:"1080p",languageNotes:"wrong"}})).status,200);
  const settings=(await post("get",{id})).body.project;
  assert.deepEqual(settings.dialogueLanguages,["English","Spanish"]);assert.deepEqual(settings.textLanguages,["Hebrew"]);assert.equal(settings.resolution,"480p");assert.equal(settings.languageNotes,"Eli speaks Spanish");
  assert.equal((await post("approvePlan",{id,planId:"stale",accepted:true})).status,409);
  assert.equal((await post("approvePlan",{id,planId:plan.planId,accepted:true})).status,200);
  const images=await worker({action:"claim",workflowVersion:3});assert.equal(images.body.project.status,"preparing");
  const imageCred={jobId:images.body.job.id,lease:images.body.job.lease};
  const ready={...images.body.project,status:"ready",assets:images.body.project.assets.map(a=>({...a,imageKey:`${id}/${a.id}.png`,referenceUrl:"https://media.example/ref.png"})),clips:images.body.project.clips.map(c=>({...c,frameKey:`${id}/${c.id}.png`,frameUrl:"https://media.example/frame.png",input:{}})),quote:{id:crypto.randomUUID(),providerCents:14000,totalCents:14000,expiresAt:Date.now()+3600000}};
  assert.equal((await worker({action:"finish",...imageCred,project:ready})).status,200);
  const edits=await Promise.all([post("reviseReference",{id,assetId:"a",changes:"Make the coat blue"}),post("reviseReference",{id,assetId:"a",changes:"Make the coat green"})]);
  assert.equal(edits.filter(r=>r.status===200).length,1,"concurrent edits enqueue only once");
  const changed=(await post("get",{id})).body.project;
  assert.equal(changed.quote,undefined);assert.equal(changed.assets[0].imageKey,undefined);assert.equal(changed.clips[0].frameKey,undefined);assert.equal(changed.clips[1].frameKey,ready.clips[1].frameKey);
  assert.equal((await post("replan",{id,targetMinutes:2})).status,409,"cannot replan during reference rebuild");
  const rebuild=await worker({action:"claim",workflowVersion:3});
  const rebuilt={...ready,operationToken:changed.operationToken};
  assert.equal((await worker({action:"finish",jobId:rebuild.body.job.id,lease:rebuild.body.job.lease,project:rebuilt})).status,200);
  const batch=[{assetId:"a",changes:"Blue coat"},{assetId:"b",changes:"Warm red walls"}];
  for(const invalid of [[batch[0],batch[0]],[batch[0],{assetId:"missing",changes:"Red wall"}]])assert.notEqual((await post("reviseReferences",{id,edits:invalid})).status,200);
  assert.equal((await post("get",{id})).body.project.status,"ready");
  const batches=await Promise.all([post("reviseReferences",{id,edits:batch}),post("reviseReferences",{id,edits:batch})]);
  assert.equal(batches.filter(r=>r.status===200).length,1);
  const batchProject=(await post("get",{id})).body.project;
  assert.equal(batchProject.assets.filter(a=>!a.imageKey).length,2);assert.equal(batchProject.clips.filter(c=>!c.frameKey).length,10);
  assert.equal(batchProject.assets[1].editInstructions,"Warm red walls");
  const batchJob=await worker({action:"claim",workflowVersion:3});
  assert.equal((await worker({action:"finish",jobId:batchJob.body.job.id,lease:batchJob.body.job.lease,project:{...ready,operationToken:batchProject.operationToken}})).status,200);
  const replanned=await post("replan",{id,targetMinutes:2});assert.equal(replanned.status,200);assert.equal(replanned.body.project.clips.length,0);assert.equal(replanned.body.project.targetMinutes,2);assert.equal(replanned.body.project.assets[0].imageKey,ready.assets[0].imageKey);assert.equal(replanned.body.project.quote,undefined);
  console.log("PASS: plan-before-images gate, exact runtime, old-worker exclusion, plan approval, selective reference invalidation, concurrent edit fencing, and unpaid runtime replanning.");
} finally {
  for(const id of fixtures){db.prepare("DELETE FROM jobs WHERE project_id=?").run(id);db.prepare("DELETE FROM productions WHERE id=?").run(id);}
  heartbeat(0);db.close();
}
