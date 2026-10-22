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
async function prepared(overrides = {}) {
  const r = await post("save", {
    title: "No-payment integration fixture",
    format: "Short film",
    style: "Cinematic",
    script: "A small empty room at dawn. Sunlight slowly crosses a wall.",
  });
  assert.equal(r.status, 200);
  const p = {
    ...r.body.project,
    status: "ready",
    quote: {
      id: crypto.randomUUID(),
      providerCents: 1400,
      serviceCents: 0,
      totalCents: 1400,
      expiresAt: Date.now() + 3600000,
    },
    ...overrides,
  };
  fixtures.push(p.id);
  db.prepare("UPDATE productions SET data=?,status='ready' WHERE id=?").run(
    JSON.stringify(p),
    p.id,
  );
  db.prepare(
    "INSERT INTO jobs(id,project_id,kind,status,created) VALUES(?,?,'prepare','complete',?)",
  ).run(crypto.randomUUID(), p.id, Date.now());
  return p;
}
const approve = (p) => ({
  id: p.id,
  accepted: true,
  irreversibleAccepted: true,
  quoteId: p.quote.id,
  providerCents: p.quote.providerCents,
});
try {
  heartbeat();
  assert.equal((await post("list")).body.ready.paymentsEnabled, false);
  const p = await prepared();
  assert.equal((await post("checkout", approve(p))).status, 403);
  for (const mismatch of [
    { accepted: false },
    { irreversibleAccepted: false },
    { quoteId: "stale" },
    { providerCents: 1 },
  ])
    assert.equal(
      (await post("approveGeneration", { ...approve(p), ...mismatch })).status,
      409,
    );
  heartbeat(0);
  assert.equal((await post("approveGeneration", approve(p))).status, 503);
  heartbeat();
  const expired = await prepared({
    quote: { ...p.quote, id: crypto.randomUUID(), expiresAt: Date.now() - 1 },
  });
  assert.equal((await post("approveGeneration", approve(expired))).status, 400);
  const other = await prepared();
  db.prepare("UPDATE productions SET owner='someone-else' WHERE id=?").run(
    other.id,
  );
  assert.equal((await post("approveGeneration", approve(other))).status, 404);
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => post("approveGeneration", approve(p))),
  );
  assert.ok(
    responses.every((r) => r.status === 200),
    JSON.stringify(responses),
  );
  const approved = (await post("get", { id: p.id })).body.project;
  assert.equal(approved.status, "queued");
  assert.equal(approved.generationAuthorization.kind, "owner-funded");
  assert.equal(approved.paidAt, undefined);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM payments WHERE project_id=?")
      .get(p.id).n,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE project_id=? AND kind='render'",
      )
      .get(p.id).n,
    1,
  );
  const claim = await worker({ action: "claim" });
  assert.equal(claim.body.project.id, p.id);
  assert.equal(claim.body.policy.markupPercent, 0);
  const cred = { jobId: claim.body.job.id, lease: claim.body.job.lease };
  assert.equal(
    (
      await worker({
        action: "checkpoint",
        ...cred,
        project: {
          ...approved,
          status: "rendering",
          generationAuthorization: undefined,
          consent: undefined,
          paidAt: 123,
          quote: { ...approved.quote, providerCents: 1 },
        },
      })
    ).status,
    200,
  );
  const preserved = (await post("get", { id: p.id })).body.project;
  assert.deepEqual(
    preserved.generationAuthorization,
    approved.generationAuthorization,
  );
  assert.deepEqual(preserved.quote, approved.quote);
  assert.equal(preserved.paidAt, undefined);
  await worker({
    action: "finish",
    ...cred,
    project: { ...preserved, status: "complete" },
  });
  const race = await prepared();
  await Promise.all([
    post("approveGeneration", approve(race)),
    post("refreshQuote", { id: race.id }),
  ]);
  const latest = (await post("get", { id: race.id })).body.project;
  const renderJobs = db
    .prepare(
      "SELECT COUNT(*) AS n FROM jobs WHERE project_id=? AND kind='render'",
    )
    .get(race.id).n;
  assert.ok(latest.status === "queued" || latest.status === "preparing");
  assert.equal(renderJobs, latest.status === "queued" ? 1 : 0);
  console.log(
    "PASS: Stripe disabled, current cost consent, expiry, offline worker, owner isolation, concurrent approvals, one render job, no fake payment, authorization preservation, approval/refresh race.",
  );
} finally {
  for (const id of fixtures) {
    db.prepare("DELETE FROM jobs WHERE project_id=?").run(id);
    db.prepare("DELETE FROM payments WHERE project_id=?").run(id);
    db.prepare("DELETE FROM productions WHERE id=?").run(id);
  }
  heartbeat(0);
  db.close();
}
