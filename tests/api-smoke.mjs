import assert from "node:assert/strict";
try {
  process.loadEnvFile(".env");
} catch {}
import {base,login as ownerLogin} from './self-host-login.mjs';
const login = await ownerLogin();
const cookie = login.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
assert.ok(cookie, "local sign-in cookie missing");
async function post(action, data = {}, options = {}) {
  const r = await fetch(base + "/api/studio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.anonymous ? {} : { Cookie: cookie }),
      ...(options.origin ? { Origin: options.origin } : {}),
    },
    body: JSON.stringify({ action, ...data }),
  });
  return {
    status: r.status,
    body: r.headers.get("content-type")?.includes("json")
      ? await r.json()
      : await r.text(),
  };
}
assert.equal((await post("list", {}, { anonymous: true })).status, 401);
assert.equal(
  (await post("list", {}, { origin: "https://untrusted.example" })).status,
  403,
);
const saved = await post("save", {
  title: "API validation draft",
  format: "Short film",
  style: "Film noir",
  script:
    "A quiet room. A person waits by a window. They hear a bell and turn toward the door.",
});
assert.equal(saved.status, 200);
const id = saved.body.project.id;
const loaded = await post("get", { id });
assert.equal(loaded.body.project.script, saved.body.project.script);
assert.equal((await post("checkout", { id, accepted: true })).status, 403);
assert.equal(
  (await post("approveGeneration", { id, accepted: true })).status,
  400,
);
assert.equal((await post("list")).body.ready.paymentsEnabled, false);
assert.equal((await post("get", { id: crypto.randomUUID() })).status, 404);
assert.equal(
  (await post("verifyPayment", { id, sessionId: "not-a-checkout" })).status,
  400,
);
assert.equal(
  (
    await fetch(base + "/api/worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim" }),
    })
  ).status,
  401,
);
assert.equal(
  (
    await fetch(base + "/api/worker", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.WORKER_SECRET,
      },
      body: JSON.stringify({
        action: "checkpoint",
        jobId: crypto.randomUUID(),
        lease: crypto.randomUUID(),
        project: {},
      }),
    })
  ).status,
  409,
);
assert.equal(
  (
    await fetch(base + "/api/media?key=" + id + "/missing.png", {
      headers: { Cookie: cookie },
    })
  ).status,
  404,
);
console.log(
  "PASS: anonymous rejection, CSRF rejection, persistent draft, payment gate, missing ownership record, invalid checkout rejection, worker auth, lease fencing, media access.",
);
