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
const groups = [];
async function library(action, data = {}) {
  const r = await fetch(base + "/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action, ...data }),
  });
  return { status: r.status, body: await r.json() };
}
try {
 const requestId=crypto.randomUUID();fixtures.push(requestId);
 const input={requestId,idea:"A lonely lighthouse keeper receives a letter from tomorrow.",title:"Tomorrow's Letter",format:"Short film",style:"Cinematic",targetMinutes:5,dialogueLanguages:["English"],textLanguages:[],resolution:"480p"};
 const started=await post("writeIdea",input);
 assert.equal(started.status,200,JSON.stringify(started));assert.equal(started.body.project.status,"writing");
 assert.equal((await post("writeIdea",input)).body.project.id,requestId);
 assert.equal(db.prepare("SELECT count(*) n FROM jobs WHERE project_id=?").get(requestId).n,1);
 assert.equal((await worker({action:"claim",workflowVersion:3})).body.job,null);
 const claimed=await worker({action:"claim",workflowVersion:4});assert.equal(claimed.body.job.project_id,requestId);
 const cred={jobId:claimed.body.job.id,lease:claimed.body.job.lease};
 const generated={...claimed.body.project,script:"INT. LIGHTHOUSE - NIGHT\n\nThe keeper opens a letter.\n\nKEEPER\nTomorrow?\n\nFADE OUT."};
 assert.equal((await worker({action:"checkpoint",...cred,project:generated})).status,200);
 assert.equal((await worker({action:"finish",...cred,project:{...generated,status:"complete"}})).status,400);
 assert.equal((await worker({action:"finish",...cred,project:{...generated,status:"draft"}})).status,200);
 const loaded=(await post("get",{id:requestId})).body.project;
 assert.equal(loaded.script,generated.script);assert.equal(loaded.status,"draft");assert.equal(loaded.assets.length,0);assert.equal(loaded.clips.length,0);
 assert.equal((await post("save",{...loaded,script:loaded.script+"\nTHE END"})).status,200);
 console.log("PASS: idea request idempotency, old-worker fencing, durable writing checkpoints, editable draft, and no media generation.");
} finally {
 for(const id of fixtures) {db.prepare("DELETE FROM jobs WHERE project_id=?").run(id);db.prepare("DELETE FROM productions WHERE id=?").run(id);}
 db.close();
}
