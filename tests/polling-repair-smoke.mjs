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
  const saved=await post("save",{title:"Polling recovery fixture",format:"Short film",style:"Cinematic",script:"An adult watches the sunrise through the window.",targetMinutes:0.5});
  assert.equal(saved.status,200);const id=saved.body.project.id;fixtures.push(id);
  const now=Date.now(), q={id:"quote",providerCents:100,totalCents:100};
  const p={...saved.body.project,status:"failed",error:"Invalid provider status endpoint.",quote:q,consent:{quoteId:q.id,totalCents:100,acceptedAt:now},generationAuthorization:{kind:"owner-funded",quoteId:q.id,providerCents:100,approvedAt:now},clips:[{id:"clip-1",requestId:"saved-request",statusUrl:"http://internal.invalid/status",status:"generating",recovery:{video:{startedAt:1,attempts:[{number:1,status:"submitted",requestId:"saved-request",startedAt:1}]}}}]};
  const write=(data)=>db.prepare("UPDATE productions SET data=?,status=?,version=version+1 WHERE id=?").run(JSON.stringify(data),data.status,id);
  write(p);db.prepare("INSERT INTO jobs(id,project_id,kind,status,created) VALUES(?,?,'render','failed',?)").run(crypto.randomUUID(),id,now);
  const unauthorized=await fetch(base+'/api/worker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'inspectProduction',projectId:id})});
  assert.equal(unauthorized.status,401);
  const inspected=await worker({action:'inspectProduction',projectId:id});assert.equal(inspected.status,200);assert.equal(inspected.body.requests[0].requestId,'saved-request');assert.equal(inspected.body.script,undefined);
  write({...p,error:'Unknown submission outcome'});assert.equal((await worker({action:'resumeStatusPolling',projectId:id})).status,409);
  write({...p,generationAuthorization:undefined});assert.equal((await worker({action:'resumeStatusPolling',projectId:id})).status,409);
  write(p);
  const resumes=await Promise.all([worker({action:'resumeStatusPolling',projectId:id}),worker({action:'resumeStatusPolling',projectId:id})]);
  assert.equal(resumes.filter(r=>r.status===200).length,1);
  const after=JSON.parse(db.prepare('SELECT data FROM productions WHERE id=?').get(id).data);
  assert.equal(after.status,'queued');assert.deepEqual(after.clips,p.clips);assert.deepEqual(after.quote,p.quote);assert.deepEqual(after.consent,p.consent);assert.deepEqual(after.generationAuthorization,p.generationAuthorization);
  assert.equal(db.prepare("SELECT count(*) AS n FROM jobs WHERE project_id=? AND status='queued'").get(id).n,1);
  const transferred=structuredClone(p);transferred.error='The operation was aborted due to timeout';
  transferred.clips[0].recovery.video.attempts[0].status='complete';
  transferred.clips[0].recovery.video.attempts[0].result={video:{url:'https://media.example/completed.mp4'}};
  db.prepare("UPDATE jobs SET status='failed' WHERE project_id=?").run(id);write({...transferred,generationAuthorization:undefined});
  assert.equal((await worker({action:'resumeMediaTransfer',projectId:id})).status,409);
  write({...p,error:transferred.error});assert.equal((await worker({action:'resumeMediaTransfer',projectId:id})).status,409,'cannot retry an uncertain submission');
  write(transferred);assert.equal((await worker({action:'resumeMediaTransfer',projectId:id})).status,200);
  const recovered=JSON.parse(db.prepare('SELECT data FROM productions WHERE id=?').get(id).data);
  assert.deepEqual(recovered.clips,transferred.clips);assert.deepEqual(recovered.quote,transferred.quote);
  for(let count=1;count<=3;count++){
    const claim=await worker({action:'claim',workflowVersion:2});assert.equal(claim.body.job.project_id,id);
    const cred={jobId:claim.body.job.id,lease:claim.body.job.lease};
    const result=await worker({action:'deferTransfer',...cred,project:claim.body.project});assert.equal(result.status,200,JSON.stringify(result));
    const queued=JSON.parse(db.prepare('SELECT data FROM productions WHERE id=?').get(id).data);
    assert.equal(queued.transferRetry.count,count);assert.deepEqual(queued.quote,transferred.quote);assert.deepEqual(queued.clips,transferred.clips);
    assert.equal((await worker({action:'claim',workflowVersion:2})).body.job,null,'delayed retries cannot be claimed early');
    assert.equal((await worker({action:'deferTransfer',...cred,project:claim.body.project})).status,409,'old lease cannot schedule twice');
    db.prepare("UPDATE jobs SET lease_until=0 WHERE project_id=?").run(id);
  }
  const exhausted=await worker({action:'claim',workflowVersion:2});
  assert.equal((await worker({action:'deferTransfer',jobId:exhausted.body.job.id,lease:exhausted.body.job.lease,project:exhausted.body.project})).status,409);
  console.log('PASS: durable recovery delay, lease fencing, preserved authorization, and persisted retry limit.');
  console.log('PASS: operator-only polling repair, approval enforcement, unrelated failures rejected, concurrent resume fenced, saved requests and budget unchanged.');
} finally {
 for(const id of fixtures){db.prepare('DELETE FROM jobs WHERE project_id=?').run(id);db.prepare('DELETE FROM productions WHERE id=?').run(id);}db.close();
}
