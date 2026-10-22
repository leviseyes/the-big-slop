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
  const saved = await post("save", {title:"Asset identity recovery fixture",format:"Short film",style:"Cinematic",script:"An adult enters a cafe.",targetMinutes:5});
  assert.equal(saved.status,200);
  const id=saved.body.project.id; fixtures.push(id);
  const p={...saved.body.project,status:"failed",workStage:"planning",error:"Conflicting asset identity in production plan.",planningUncertain:true,planChunks:1,assets:[{id:"adult",kind:"character",name:"Adult"}],clips:Array.from({length:5},(_,i)=>({id:`clip-${i+1}`,assetIds:["adult"]}))};
  const write=data=>db.prepare("UPDATE productions SET data=?,status=?,version=version+1 WHERE id=?").run(JSON.stringify(data),data.status,id);
  db.prepare("INSERT INTO jobs(id,project_id,kind,status,created) VALUES(?,?,'prepare','failed',?)").run(crypto.randomUUID(),id,Date.now());
  for (const change of [{error:"Unknown submission outcome"},{runtimeApprovedAt:Date.now()},{generationAuthorization:{kind:"owner-funded"}},{clips:[{requestId:"already-submitted"}]},{assets:[{imageKey:"already-generated"}]}]) {
    write({...p,...change}); assert.equal((await worker({action:"resumeAssetPlanning",projectId:id})).status,409);
  }
  write(p);
  const resumed=await Promise.all([worker({action:"resumeAssetPlanning",projectId:id}),worker({action:"resumeAssetPlanning",projectId:id})]);
  assert.equal(resumed.filter(r=>r.status===200).length,1,JSON.stringify(resumed));
  const after=JSON.parse(db.prepare("SELECT data FROM productions WHERE id=?").get(id).data);
  assert.equal(after.status,"planning");assert.equal(after.planChunks,1);assert.equal(after.planningUncertain,false);
  assert.deepEqual(after.clips,p.clips);assert.deepEqual(after.assets,p.assets);assert.equal(after.script,p.script);
  assert.equal(db.prepare("SELECT count(*) AS n FROM jobs WHERE project_id=? AND status='queued'").get(id).n,1);
  console.log("PASS: identity recovery preserves completed sections, fences concurrent resumes, and rejects unrelated or already-generated productions.");
} finally {
  for(const id of fixtures){db.prepare("DELETE FROM jobs WHERE project_id=?").run(id);db.prepare("DELETE FROM productions WHERE id=?").run(id);}db.close();
}
