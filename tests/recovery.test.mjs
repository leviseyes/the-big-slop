import test from "node:test";
import assert from "node:assert/strict";
import {
  recoverGeneration,
  RejectedGeneration,
  providerFailure,
  videoTerminalFailure,
  MAX_GENERATION_ATTEMPTS,
  RECOVERY_DEADLINE_MS,
} from "../services/recovery.mjs";
const revised = {
  canProceed: true,
  prompt: "A fully clothed adult watches a peaceful landscape.",
  replacementFramePrompt: "Peaceful landscape, safe reaction shot.",
  summary: "Changed to a non-graphic reaction shot.",
};
const defaults = {
  prompt: "original scene",
  checkpoint: async () => {},
  rewrite: async () => revised,
  sleep: async () => {},
};

test("confirmed rejection rewrites, replaces policy frame, records history, and continues", async () => {
  const state = {},
    snapshots = [];
  const result = await recoverGeneration({
    ...defaults,
    state,
    checkpoint: async () => snapshots.push(structuredClone(state)),
    execute: async (attempt, s) => {
      if (attempt.number === 1)
        throw videoTerminalFailure({
          status: "nsfw",
          error: "Moderation rejected",
        });
      assert.equal(s.prompt, revised.prompt);
      assert.equal(s.replacementFramePrompt, revised.replacementFramePrompt);
      assert.equal(s.textOnly, true);
      return { video: { url: "https://media.example/accepted.mp4" } };
    },
  });
  assert.ok(result.video);
  assert.deepEqual(
    state.attempts.map((a) => a.status),
    ["rejected", "complete"],
  );
  assert.ok(snapshots.some((s) => s.rewriting));
  assert.ok(snapshots.some((s) => s.attempts.at(-1).status === "submitting"));
});
test("repeated rejection stops at a persisted finite limit, including after restart", async () => {
  const state = {};
  let calls = 0,
    rewrites = 0;
  const options = {
    ...defaults,
    state,
    rewrite: async () => {
      rewrites++;
      return revised;
    },
    execute: async () => {
      calls++;
      throw new RejectedGeneration("rejected");
    },
  };
  await assert.rejects(recoverGeneration(options), /five|5 attempts/);
  assert.equal(calls, MAX_GENERATION_ATTEMPTS);
  assert.equal(rewrites, MAX_GENERATION_ATTEMPTS - 1);
  await assert.rejects(
    recoverGeneration({ ...options, state: structuredClone(state) }),
    /5 attempts/,
  );
  assert.equal(calls, MAX_GENERATION_ATTEMPTS);
});
test("network timeouts and unknown submissions never trigger duplicate generation", async () => {
  const state = {};
  let calls = 0;
  const options = {
    ...defaults,
    state,
    execute: async () => {
      calls++;
      throw new Error("timeout");
    },
  };
  await assert.rejects(recoverGeneration(options), /timeout/);
  await assert.rejects(
    recoverGeneration({ ...options, state: structuredClone(state) }),
    /uncertain outcome/,
  );
  assert.equal(calls, 1);
});
test("known video request resumes polling and a completed result is reused", async () => {
  const state = {
    attempts: [
      {
        number: 1,
        status: "submitted",
        requestId: "existing",
        startedAt: Date.now(),
      },
    ],
  };
  let calls = 0;
  const options = {
    ...defaults,
    state,
    execute: async (attempt) => {
      calls++;
      assert.equal(attempt.requestId, "existing");
      return "stored";
    },
  };
  assert.equal(await recoverGeneration(options), "stored");
  assert.equal(await recoverGeneration(options), "stored");
  assert.equal(calls, 1);
});
test("checkpoint interruption before POST prevents subsequent blind submission", async () => {
  const state = {};
  let calls = 0;
  await assert.rejects(
    recoverGeneration({
      ...defaults,
      state,
      checkpoint: async () => {
        throw new Error("storage unavailable");
      },
      execute: async () => calls++,
    }),
    /storage unavailable/,
  );
  await assert.rejects(
    recoverGeneration({ ...defaults, state, execute: async () => calls++ }),
    /uncertain/,
  );
  assert.equal(calls, 0);
});
test("rate limits back off without rewriting, auth/credits/schema/server faults do not retry", async () => {
  for (const status of [401, 403, 404, 422, 500, 503])
    assert.equal(providerFailure("Higgsfield", status, {}).constructor, Error);
  assert.ok(
    providerFailure("OpenAI", 400, {
      error: { code: "content_policy_violation" },
    }) instanceof RejectedGeneration,
  );
  let rewrites = 0;
  const waits = [];
  await recoverGeneration({
    ...defaults,
    state: {},
    rewrite: async () => {
      rewrites++;
      return revised;
    },
    sleep: async (ms) => waits.push(ms),
    execute: async (a) => {
      if (a.number < 3) throw providerFailure("Higgsfield", 429, {});
      return true;
    },
  });
  assert.equal(rewrites, 0);
  assert.deepEqual(waits, [2000, 4000]);
  assert.equal(videoTerminalFailure({ status: "canceled" }).constructor, Error);
});
test("no safe adaptation, uncertain rewrite, and deadline each stop without more generation", async () => {
  let calls = 0;
  await assert.rejects(
    recoverGeneration({
      ...defaults,
      state: {},
      rewrite: async () => ({ canProceed: false }),
      execute: async () => {
        calls++;
        throw new RejectedGeneration("rejected");
      },
    }),
    /suitable replacement/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    recoverGeneration({
      ...defaults,
      state: { rewriting: true },
      execute: async () => calls++,
    }),
    /rewrite has an uncertain/,
  );
  await assert.rejects(
    recoverGeneration({
      ...defaults,
      now: () => RECOVERY_DEADLINE_MS + 2,
      state: { startedAt: 1 },
      execute: async () => calls++,
    }),
    /six-hour/,
  );
  assert.equal(calls, 1);
});

test('expired saved request can be read but cannot trigger another paid retry', async () => {
  const state = { startedAt: 1, attempts: [{ number: 1, status: 'submitted', requestId: 'saved', startedAt: 1 }] };
  let reads = 0, rewrites = 0;
  await assert.rejects(recoverGeneration({ ...defaults, state, now: () => RECOVERY_DEADLINE_MS + 10,
    rewrite: async () => { rewrites++; return revised; },
    execute: async () => { reads++; throw videoTerminalFailure({status:'failed'}); },
  }), /six-hour/);
  assert.equal(reads, 1); assert.equal(rewrites, 0);
});

test('invalid director output is saved with a precise reason and never blindly retried', async () => {
  for (const [output, reason] of [[{canProceed:false},'no_safe_adaptation'], [{canProceed:true,prompt:''},'empty_prompt'], [{canProceed:true,prompt:'x'.repeat(6001)},'prompt_too_long']]) {
    const state = {}; let rewrites=0, generations=0;
    const options={...defaults,state,rewrite:async()=>{rewrites++;return output;},execute:async()=>{generations++;throw new RejectedGeneration('rejected');}};
    await assert.rejects(recoverGeneration(options));
    assert.equal(state.rewriting,false);
    assert.equal(state.revisionError,reason);
    assert.deepEqual(state.lastRevision,output);
    await assert.rejects(recoverGeneration(options),/needs review/);
    assert.equal(rewrites,1); assert.equal(generations,1);
  }
});
import {authorizeReferenceRetry, IMAGE_CONNECTION_UNCERTAIN} from '../services/recovery.mjs';
test('uncertain image retries require explicit acceptance and retain attempt history',async()=>{
 const p={status:'failed',error:'fetch failed',workStage:'references',runtimeApprovedAt:1,assets:[{id:'saved',imageKey:'saved.png',referenceUrl:'https://saved.example/a'},{id:'riley',recovery:{reference:{startedAt:1,attempts:[{number:1,status:'submitting'}]}}}]};
 const original=structuredClone(p);
 for(const accepted of [undefined,false])assert.throws(()=>authorizeReferenceRetry(p,'riley',accepted,100),/not eligible/);
 assert.deepEqual(p,original);
 assert.throws(()=>authorizeReferenceRetry(p,'wrong-id',true,100));
 assert.equal(authorizeReferenceRetry(p,'riley',true,100),'riley');
 const state=p.assets[1].recovery.reference;
 assert.equal(state.attempts.length,1);assert.equal(state.attempts[0].outcomeUncertain,true);assert.equal(state.startedAt,100);
 assert.deepEqual(p.assets[0],original.assets[0]);
 let calls=0;
 await recoverGeneration({state,prompt:'saved prompt',checkpoint:async()=>{},rewrite:()=>assert.fail('not a policy rejection'),execute:async()=>{calls++;return 'new-image'},sleep:async()=>{},now:()=>101});
 assert.equal(calls,1);assert.equal(state.attempts.length,2);
 for(const change of [{error:'Safety rejection'},{status:'preparing'},{runtimeApprovedAt:undefined},{referencesApprovedAt:1},{generationAuthorization:{}}])assert.throws(()=>authorizeReferenceRetry({...structuredClone(original),...change},'riley',true));
 const friendly={...structuredClone(original),error:IMAGE_CONNECTION_UNCERTAIN};assert.equal(authorizeReferenceRetry(friendly,'riley',true),'riley');
});
