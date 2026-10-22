// Loaded ONLY by the worker integration test. All network traffic is intercepted.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const counters = { video: 0, images: 0, rewrites: 0, uploads: [], partAttempts: {}, completionChecks: 0 };
const now = Date.now();
let p = {
  id: "recovery-fixture",
  title: "Recovery test",
  script: "An adult watches the sunrise. The adult walks away.",
  style: "Cinematic",
  status: "queued",
  assets: [],
  quote: { id: "quote-test", providerCents: 200, totalCents: 200 },
  consent: { quoteId: "quote-test", totalCents: 200, acceptedAt: now },
  generationAuthorization: {
    kind: "owner-funded",
    quoteId: "quote-test",
    providerCents: 200,
    approvedAt: now,
  },
  clips: [
    {
      id: "clip-1", assetIds: [],
      prompt: "An adult watches sunrise.",
      estimatedUsd: 1,
      videoKey: "recovery-fixture/clips/clip-1.mp4",
      status: "complete",
    },
    {
      id: "clip-2", assetIds: [],
      prompt: "An adult walks away.",
      estimatedUsd: 1,
      frameUrl: "https://media.example/original.png",
      input: {
        prompt: "An adult walks away.",
        image_url: "https://media.example/original.png",
        duration: 30,
        resolution: "720p",
      },
      status: "planned",
    },
  ],
};
if (process.env.TEST_RESUME_POLLING === "1" || (process.env.TEST_TRANSFER === "1" || process.env.TEST_DEFER === "1")) {
  const clip = p.clips[1];
  clip.requestId = "request-2";
  clip.statusUrl = "http://internal-provider.invalid/requests/request-2/status";
  clip.status = "generating";
  clip.recovery = { video: { startedAt: now - 24 * 3600000, attempts: [{
    number: 1, status: "submitted", requestId: clip.requestId,
    statusUrl: clip.statusUrl, startedAt: now - 24 * 3600000,
  }] } };
}
if ((process.env.TEST_TRANSFER === "1" || process.env.TEST_DEFER === "1")) {
 const a=p.clips[1].recovery.video.attempts[0];a.status='complete';a.result={video:{url:'https://media.example/accepted.mp4'}};
}
const json = (data, status = 200) => Response.json(data, { status });
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.origin === "http://worker.test") {
    if (options.method === "PUT") {
      if(u.searchParams.has('uploadId')) {
        const n=u.searchParams.get('part');counters.partAttempts[n]=(counters.partAttempts[n]||0)+1;
        assert.ok(options.body.length <= 5*1024*1024);
        if(process.env.TEST_DEFER === '1' || (n==='1' && counters.partAttempts[n]===1)) throw new DOMException('timeout','TimeoutError');
        return json({partNumber:Number(n),etag:'part-'+n});
      }
      counters.uploads.push(u.searchParams.get("key"));
      return json({ ok: true });
    }
    if (!options.method || options.method === "GET")
      return new Response(
        await fs.readFile(
          u.searchParams.get("key").endsWith(".png")
            ? "frame.png"
            : "source.mp4",
        ),
      );
    const b = JSON.parse(options.body);
    if(b.action==='deferTransfer'){
      assert.equal(b.project.failedOperation,'media-transfer');
      assert.equal(b.project.clips[1].recovery.video.attempts[0].status,'complete');
      await fs.writeFile('result.json',JSON.stringify({project:{...b.project,status:'queued'},counters}));process.emit('SIGTERM');return json({ok:true});
    }
    if(b.action==='multipartAbort')return json({ok:true});
    if(b.action==='multipartStart')return json({uploadId:'multipart-test'});
    if(b.action==='multipartComplete'){
      counters.uploads.push(b.key);
      throw new DOMException('Lost completion response','TimeoutError');
    }
    if(b.action==='mediaInfo'){counters.completionChecks++;return json({exists:true,size:(await fs.stat('source.mp4')).size});}
    if (b.action === "claim")
      return json({
        job: { id: "job", lease: "lease", kind: "render" },
        project: p,
      });
    if (b.action === "checkpoint" || b.action === "finish") {
      p = structuredClone(b.project);
      if (b.action === "finish") {
        await fs.writeFile(
          "result.json",
          JSON.stringify({ project: p, counters }),
        );
        process.emit("SIGTERM");
      }
      return json({ ok: true });
    }
    if (b.action === "heartbeat") return json({ ok: true });
  }
  if (u.origin === "https://api.openai.com") {
    const b = JSON.parse(options.body);
    if (u.pathname === "/v1/responses") {
      if(b.text?.format?.name === "continuity_review") return json({id:"resp_review",status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify({passed:true,reason:"Synthetic safe fixture matches references."})}]}]});
      counters.rewrites++;
      assert.ok(
        JSON.parse(b.input).prompt?.length,
        "director must receive the rejected prompt",
      );
      assert.match(b.instructions, /Never evade safeguards/);
      return json({
        id: "resp_recovery",status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  canProceed: true,
                  prompt:
                    "A fully clothed adult walks through a peaceful garden. Calm dialogue and natural movement.",
                  replacementFramePrompt:
                    "A fully clothed adult in a peaceful garden, centered widescreen composition.",
                  summary: "Used a peaceful garden reaction shot.",
                }),
              },
            ],
          },
        ],
      });
    }
    if (u.pathname === "/v1/images/generations") {
      counters.images++;
      assert.equal(b.model, "gpt-image-2.5-sunburst");
      assert.equal(b.size, "1024x1024");
      if (counters.images === 1)
        return json(
          {
            error: {
              code: "content_policy_violation",
              message: "Content rejected",
            },
          },
          400,
        );
      return json({
        data: [
          { b64_json: (await fs.readFile("frame.png")).toString("base64") },
        ],
      });
    }
  }
  if (u.origin === "https://api.higgsfield.ai") {
    if (u.pathname.startsWith("/estimate/")) return json({ usd: 1 });
    if (u.pathname === "/files/generate-upload-url")
      return json({
        upload_url: "https://media.example/upload",
        public_url: "https://media.example/replacement.png",
      });
    if (u.pathname === "/bytedance/seedance-2.5/image-to-video") {
      counters.video++;
      const b = JSON.parse(options.body);
      assert.equal(b.duration, 30);
      assert.equal(b.resolution, "720p");
      assert.match(b.prompt, /SPOKEN AUDIO LANGUAGE: English ONLY/);
      assert.match(b.prompt, /Speak the supplied dialogue verbatim/);
      if (counters.video === 2)
        assert.equal(b.image_url, "https://media.example/replacement.png");
      return json({
        request_id: `request-${counters.video}`,
        status_url: counters.video === 1 ? `http://internal-provider.invalid/requests/request-${counters.video}/status` : undefined,
      });
    }
    if (u.pathname === "/requests/request-1/status")
      return json({ status: "nsfw", error: "Content rejected" });
    if (u.pathname === "/requests/request-2/status")
      return json({
        status: "completed",
        video: { url: "https://media.example/accepted.mp4" },
      });
  }
  if (u.origin === "https://media.example") {
    if (options.method === "PUT") return new Response(null, { status: 200 });
    if (u.pathname === "/accepted.mp4")
      return new Response(await fs.readFile("source.mp4"));
  }
  throw new Error(
    `Unexpected network access blocked by integration test: ${u.origin}${u.pathname}`,
  );
};
