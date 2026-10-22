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
  const create=async()=>{
    const r=await post("save",{title:"Preparation quota fixture",format:"Short film",style:"Cinematic",script:"An adult walks into a quiet room and opens the window.",targetMinutes:.5});
    assert.equal(r.status,200);fixtures.push(r.body.project.id);return r.body.project;
  };
  const first=await create(),second=await create();
  const starts=await Promise.all([post("prepare",{id:first.id}),post("prepare",{id:first.id})]);
  assert.equal(starts.filter(r=>r.status===200).length,1,"concurrent start succeeds exactly once");
  assert.equal(starts.find(r=>r.status!==200).body.code,"production_started");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE project_id=?").get(first.id).n,1);
  const started=(await post("get",{id:first.id})).body.project;
  const ownLimit=Number(process.env.DAILY_PREPARATIONS_PER_USER || 1);
  const studioLimit=Number(process.env.DAILY_PREPARATIONS_GLOBAL || 10);
  const owner=db.prepare("SELECT owner FROM productions WHERE id=?").get(first.id).owner;
  // Fill the remaining per-user slots using synthetic rows, with no AI calls.
  for(let i=1;i<ownLimit;i++){
    const fixture=await create();
    db.prepare("UPDATE productions SET data=? WHERE id=?").run(JSON.stringify({...fixture,preparationStartedAt:started.preparationStartedAt}),fixture.id);
  }
  const denied=await post("prepare",{id:second.id});
  assert.equal(denied.status,429);assert.equal(denied.body.code,"preparation_user_limit");
  assert.match(denied.body.error,/rolling 24 hours/);assert.equal(denied.body.retryAt,started.preparationStartedAt+86400000);
  assert.equal((await post("get",{id:second.id})).body.project.status,"draft");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE project_id=?").get(second.id).n,0);
  for(const id of fixtures){const row=db.prepare("SELECT data FROM productions WHERE id=?").get(id);const p=JSON.parse(row.data);if(p.preparationStartedAt){p.preparationStartedAt=Date.now()-86401000;db.prepare("UPDATE productions SET data=? WHERE id=?").run(JSON.stringify(p),id);}}
  const globalStarted=Date.now();
  for(let i=0;i<studioLimit;i++){
    const fixture=await create();
    db.prepare("UPDATE productions SET owner=?,data=? WHERE id=?").run("quota-other-user",JSON.stringify({...fixture,preparationStartedAt:globalStarted}),fixture.id);
  }
  const studioDenied=await post("prepare",{id:second.id});
  assert.equal(studioDenied.status,429);assert.equal(studioDenied.body.code,"preparation_studio_limit");assert.equal(studioDenied.body.retryAt,globalStarted+86400000);
  for(const id of fixtures){const row=db.prepare("SELECT data FROM productions WHERE id=? AND owner=?").get(id,"quota-other-user");if(row){const p=JSON.parse(row.data);p.preparationStartedAt=Date.now()-86401000;db.prepare("UPDATE productions SET data=? WHERE id=?").run(JSON.stringify(p),id);}}
  assert.equal((await post("prepare",{id:second.id})).status,200,"expired rolling-window entries free a new slot");
  console.log("PASS: distinct user/studio quota messages, exact reset timestamps, preserved drafts, no jobs on quota denial, rolling expiry and duplicate-start fencing. No provider calls.");
} finally {
  for(const id of fixtures){db.prepare("DELETE FROM jobs WHERE project_id=?").run(id);db.prepare("DELETE FROM productions WHERE id=?").run(id);}
  heartbeat(0);db.close();
}
