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
  const saved = await post("save", {
    title: "Library integration fixture",
    format: "Short film",
    style: "Cinematic",
    script: "An adult walks into a quiet room and opens the window.",
    targetMinutes: 0.5,
  });
  assert.equal(saved.status, 200);
  const p = saved.body.project;
  fixtures.push(p.id);
  const owner = db
    .prepare("SELECT owner FROM productions WHERE id=?")
    .get(p.id).owner;
  const created = await library("createSeries", {
    name: "Continuity test series",
    category: "TV show",
  });
  assert.equal(created.status, 200, JSON.stringify(created));
  const sid = created.body.series.id;
  groups.push(sid);
  const imageKey = p.id + "/assets/mara.png",
    editedKey = p.id + "/assets/mara-v2.png";
  const reference = {
    id: "mara",
    name: "Mara",
    kind: "character",
    description: "Yellow uniform",
    prompt: "Portrait",
    imageKey,
  };
  const original = {
    ...p,
    status: "complete",
    productionBible: "Red booths, warm amber light",
    assets: [reference],
    clips: [{ id: "clip-1", frameKey: p.id + "/frame.png" }],
    outputKey: p.id + "/final.mp4",
  };
  db.prepare("UPDATE productions SET data=?,status='complete' WHERE id=?").run(
    JSON.stringify(original),
    p.id,
  );
  const beforeRename = db
    .prepare("SELECT version,data FROM productions WHERE id=?")
    .get(p.id);
  assert.equal(
    (await library("rename", { id: p.id, title: "  A new title  " })).body
      .title,
    "A new title",
  );
  assert.deepEqual(
    db.prepare("SELECT version,data FROM productions WHERE id=?").get(p.id),
    beforeRename,
  );
  assert.equal(
    (await post("get", { id: p.id })).body.project.title,
    "A new title",
  );
  assert.equal(
    (await post("list")).body.projects.find((x) => x.id === p.id).title,
    "A new title",
  );
  assert.equal(
    (await library("list")).body.productions.find((x) => x.id === p.id).title,
    "A new title",
  );
  assert.equal(
    (await library("rename", { id: p.id, title: "  " })).status,
    400,
  );
  assert.equal(
    (await library("rename", { id: p.id, title: "x".repeat(121) })).status,
    400,
  );
  assert.equal(
    (
      await library("organize", {
        id: p.id,
        category: "TV show",
        title: "Title and format saved together",
        seriesId: sid,
      })
    ).status,
    200,
  );
  assert.equal((await post("get", {id:p.id})).body.project.title, "Title and format saved together");
  let stored = (await library("series", { seriesId: sid })).body.series;
  assert.equal(stored.assets[0].imageKey, imageKey);
  assert.equal(stored.productionBible, original.productionBible);
  const sourceJob = crypto.randomUUID(),
    sourceLease = crypto.randomUUID();
  db.prepare(
    "INSERT INTO jobs(id,project_id,kind,status,lease,lease_until,created) VALUES(?,?,'prepare','running',?,?,?)",
  ).run(sourceJob, p.id, sourceLease, Date.now() + 120000, Date.now());
  const sourceUpload = await fetch(
    base +
      "/api/worker?" +
      new URLSearchParams({
        jobId: sourceJob,
        lease: sourceLease,
        key: imageKey,
      }),
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.WORKER_SECRET}`,
        "Content-Type": "image/png",
      },
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9sAAAAASUVORK5CYII=",
        "base64",
      ),
    },
  );
  assert.equal(sourceUpload.status, 200);
  db.prepare("UPDATE jobs SET status='complete',lease=NULL WHERE id=?").run(
    sourceJob,
  );
  const episode = await library("newEpisode", { seriesId: sid });
  assert.equal(episode.status, 200);
  const ep = episode.body.project;
  fixtures.push(ep.id);
  heartbeat();
  const planned = await post("prepare", { id: ep.id });
  assert.equal(planned.status, 400, "empty episode cannot start production");
  await post("save", { ...ep, script: p.script });
  const prepared = await post("prepare", { id: ep.id });
  assert.equal(prepared.status, 200, JSON.stringify(prepared));
  assert.equal(prepared.body.project.assets[0].imageKey, imageKey);
  assert.equal(prepared.body.project.assets[0].referenceUrl, undefined);
  assert.equal(prepared.body.project.productionBible, original.productionBible);
  const claim = await worker({ action: "claim", workflowVersion: 3 });
  assert.equal(claim.body.job.project_id, ep.id);
  const cred = { jobId: claim.body.job.id, lease: claim.body.job.lease };
  const upload = await fetch(
    base +
      "/api/worker?" +
      new URLSearchParams({ ...cred, key: ep.id + "/test.png" }),
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.WORKER_SECRET}`,
        "Content-Type": "image/png",
      },
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9sAAAAASUVORK5CYII=",
        "base64",
      ),
    },
  );
  assert.equal(upload.status, 200);
  // A leased worker may read the exact inherited key, never unrelated media.
  const inherited = await fetch(
    base + "/api/worker?" + new URLSearchParams({ ...cred, key: imageKey }),
    { headers: { Authorization: `Bearer ${process.env.WORKER_SECRET}` } },
  );
  assert.equal(inherited.status, 200);
  assert.equal(inherited.headers.get("Content-Type"), "image/png");
  const arbitrary = await fetch(
    base +
      "/api/worker?" +
      new URLSearchParams({ ...cred, key: p.id + "/unlisted.png" }),
    { headers: { Authorization: `Bearer ${process.env.WORKER_SECRET}` } },
  );
  assert.equal(arbitrary.status, 400);
  assert.equal(
    (
      await library("rename", {
        id: ep.id,
        title: "Renamed during preparation",
      })
    ).status,
    200,
  );
  const checkpointProject = {
    ...claim.body.project,
    assets: [
      ...claim.body.project.assets,
      {
        id: "room",
        kind: "location",
        name: "Room",
        description: "Amber room",
        imageKey: ep.id + "/test.png",
      },
    ],
  };
  assert.equal(
    (
      await worker({
        action: "checkpoint",
        ...cred,
        project: checkpointProject,
      })
    ).status,
    200,
  );
  assert.equal(
    (await library("series", { seriesId: sid })).body.series.assets.find(
      (a) => a.id === "room",
    ).imageKey,
    ep.id + "/test.png",
    "worker automatically saves new references",
  );
  const version = db
    .prepare("SELECT version FROM productions WHERE id=?")
    .get(ep.id).version;
  assert.equal(
    (
      await library("organize", {
        id: ep.id,
        category: "SaaS video",
        seriesId: sid,
      })
    ).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT version FROM productions WHERE id=?").get(ep.id).version,
    version,
    "category move must not interrupt worker checkpoint",
  );
  assert.equal(
    (
      await worker({
        action: "checkpoint",
        ...cred,
        project: { ...checkpointProject, phase: "Test checkpoint" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await post("get", { id: ep.id })).body.project.category,
    "SaaS video",
  );
  assert.equal(
    (
      await library("organize", {
        id: ep.id,
        category: "SaaS video",
        seriesId: null,
      })
    ).status,
    409,
    "cannot change series during planning",
  );
  const current = (await post("get", { id: p.id })).body.project;
  db.prepare("UPDATE productions SET data=? WHERE id=?").run(
    JSON.stringify({
      ...current,
      assets: [{ ...reference, imageKey: editedKey }],
    }),
    p.id,
  );
  assert.equal(
    (await post("get", { id: ep.id })).body.project.title,
    "Renamed during preparation",
  );
  await library("organize", { id: p.id, category: "TV show", seriesId: sid });
  assert.equal(
    (await library("series", { seriesId: sid })).body.series.assets[0].imageKey,
    imageKey,
    "automatic capture keeps canonical reference",
  );
  assert.equal((await library("adoptReferences", { id: p.id })).status, 200);
  assert.equal(
    (await library("series", { seriesId: sid })).body.series.assets[0].imageKey,
    editedKey,
  );
  assert.equal(
    (await post("get", { id: ep.id })).body.project.assets[0].imageKey,
    imageKey,
    "existing episode snapshot is unchanged",
  );
  const listed = await library("list");
  assert.equal(listed.status, 200);
  assert.equal(
    listed.body.productions.find((x) => x.id === p.id).posterKey,
    p.id + "/frame.png",
  );
  const oldReference = await fetch(
    base + "/api/media?key=" + encodeURIComponent(imageKey),
    { headers: { Cookie: cookie } },
  );
  assert.equal(
    oldReference.status,
    200,
    "old episode snapshot resolves even after the canonical library reference changes",
  );
  db.prepare("UPDATE series SET owner='different-owner' WHERE id=?").run(sid);
  assert.equal((await library("series", { seriesId: sid })).status, 404);
  assert.equal((await library("newEpisode", { seriesId: sid })).status, 404);
  assert.equal(
    (
      await library("organize", {
        id: p.id,
        category: "TV show",
        seriesId: sid,
      })
    ).status,
    404,
  );
  db.prepare("UPDATE series SET owner=? WHERE id=?").run(owner, sid);
  const noauth = await fetch(base + "/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list" }),
  });
  assert.equal(noauth.status, 401);
  assert.equal(
    (
      await library("createSeries", {
        name: "Invalid",
        category: "not-a-category",
      })
    ).status,
    400,
  );
  console.log(
    "PASS: categories, series persistence, canonical reference reuse, episode snapshots, active-worker safety, private ownership, and inherited-media access. No AI generation.",
  );
} finally {
  for (const id of fixtures) {
    db.prepare("DELETE FROM jobs WHERE project_id=?").run(id);
    db.prepare("DELETE FROM productions WHERE id=?").run(id);
  }
  for (const id of groups) {
    db.prepare("DELETE FROM series_assets WHERE series_id=?").run(id);
    db.prepare("DELETE FROM series WHERE id=?").run(id);
  }
  heartbeat(0);
  db.close();
}
