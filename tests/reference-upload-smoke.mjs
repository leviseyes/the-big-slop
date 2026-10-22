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
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9sAAAAASUVORK5CYII=",
  "base64",
);
async function uploadRefs(id, entries, bytes = png, auth = cookie) {
  const form = new FormData();
  form.set("id", id);
  form.set("references", JSON.stringify(entries));
  for (const e of entries)
    form.set(
      e.uploadId,
      new Blob([bytes], { type: "image/png" }),
      "reference.png",
    );
  const r = await fetch(base + "/api/references", {
    method: "POST",
    headers: { Cookie: auth },
    body: form,
  });
  return { status: r.status, body: await r.json() };
}
const item = (name, kind = "character") => ({
  uploadId: crypto.randomUUID(),
  name,
  kind,
  description: `Use the supplied ${name} image, preserving appearance.`,
});
try {
 heartbeat();
 const saved=await post("save",{title:"Reference review fixture",format:"Short film",style:"Cinematic",script:"Mara opens a book in the cafe.",targetMinutes:0.5});
 assert.equal(saved.status,200);const id=saved.body.project.id;fixtures.push(id);
 const a=item("Mara"),b=item("Cafe","location");
 assert.equal((await uploadRefs(id,[a])).status,409,"draft upload must be rejected");
 const p={...saved.body.project,status:"preparing",workflowVersion:3,runtimeApprovedAt:Date.now(),assets:[{id:"mara",name:"Mara",kind:"character",description:"Yellow coat",imageKey:id+"/mara.png"},{id:"cafe",name:"Cafe",kind:"location",description:"Warm room",imageKey:id+"/cafe.png"}],clips:[{id:"clip-1",assetIds:["mara","cafe"],frameKey:id+"/frame.png",frameUrl:"https://example.com/frame.png",storyboard:[{imageKey:id+"/board.png",referenceUrl:"https://example.com/board.png"}]}]};
 db.prepare("UPDATE productions SET data=?,status='preparing' WHERE id=?").run(JSON.stringify(p),id);
 const jobId=crypto.randomUUID(),lease=crypto.randomUUID();
 db.prepare("INSERT INTO jobs(id,project_id,kind,status,lease,lease_until,created) VALUES(?,?,'prepare','running',?,?,?)").run(jobId,id,lease,Date.now()+120000,Date.now());
 assert.equal((await worker({action:"finish",jobId,lease,project:{...p,status:"references_ready"}})).status,200);
 assert.equal((await uploadRefs(id,[{...a,assetId:"mara"}],Buffer.from("bad"))).status,400);
 assert.equal((await uploadRefs(id,[a],png,"")).status,401);
 const replaced=await uploadRefs(id,[{...a,assetId:"mara"},{...b,assetId:"cafe"}]);assert.equal(replaced.status,200,JSON.stringify(replaced));
 assert.equal(replaced.body.project.status,"references_ready");assert.equal(replaced.body.project.clips[0].frameKey,undefined);
 assert.equal(replaced.body.project.clips[0].storyboard[0].imageKey,undefined);
 assert.equal(db.prepare("SELECT count(*) n FROM jobs WHERE project_id=? AND status IN ('queued','running')").get(id).n,0,"uploads must not start production");
 assert.equal((await uploadRefs(id,[item("Book","object")])).status,400,"new image must be assigned to clips");
 const added=await uploadRefs(id,[{...item("Book","object"),clipIds:["clip-1"]}]);assert.equal(added.status,200,JSON.stringify(added));assert.equal(added.body.project.assets.length,3);assert.equal(added.body.project.clips[0].assetIds.length,3);
 const image=await fetch(base+"/api/media?key="+encodeURIComponent(added.body.project.assets[0].imageKey),{headers:{Cookie:cookie}});assert.equal(image.status,200);
 assert.equal((await post("approveReferences",{id,edits:[{assetId:"mara",description:"Blue jacket",changes:"Use another character",referenceIds:["asset:missing"]}]})).status,400);
 const done=await post("approveReferences",{id,edits:[{assetId:"mara",description:"Blue jacket, short hair",changes:"Make the jacket blue",referenceIds:["asset:cafe"]},{assetId:"cafe",description:"Amber lighting and wooden booths",changes:""}]});assert.equal(done.status,200,JSON.stringify(done));
 assert.equal(done.body.project.status,"preparing");assert.deepEqual(done.body.project.assets[0].editReferenceIds,["asset:cafe"]);assert.equal(done.body.project.editReferenceLibrary.find(r=>r.id==="asset:cafe").description,"Amber lighting and wooden booths");assert.ok(done.body.project.referencesApprovedAt);assert.equal(done.body.project.assets[0].description,"Blue jacket, short hair");assert.equal(done.body.project.assets[0].imageKey,undefined);assert.ok(done.body.project.assets[1].imageKey);
 assert.equal(db.prepare("SELECT count(*) n FROM jobs WHERE project_id=? AND status='queued'").get(id).n,1);
 assert.equal((await post("approveReferences",{id,edits:[]})).status,409);
 assert.equal((await uploadRefs(id,[{...a,assetId:"mara"}])).status,409);
 db.prepare("UPDATE jobs SET status='complete' WHERE project_id=?").run(id);
 db.prepare("UPDATE productions SET data=?,status='ready' WHERE id=?").run(JSON.stringify({...p,status:"ready",generationAuthorization:{kind:"owner-funded"}}),id);
 assert.equal((await uploadRefs(id,[{...a,assetId:"mara"}])).status,409);
 console.log("PASS: post-generation review gate, bulk uploads/descriptions, explicit clip assignment, no work before Done, selective regeneration, private media and committed locks.");
} finally {
 for(const id of fixtures){db.prepare("DELETE FROM jobs WHERE project_id=?").run(id);db.prepare("DELETE FROM productions WHERE id=?").run(id);}
 heartbeat(0);db.close();
}
