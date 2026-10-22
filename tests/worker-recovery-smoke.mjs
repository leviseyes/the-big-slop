import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "slop-recovery-test-"));
// No real credentials are loaded. All provider and studio fetches are mocked.
const ffmpeg =
  process.env.FFMPEG_PATH ||
  path.join(root, "node_modules/ffmpeg-static/ffmpeg");
const { default: probe } = await import("ffprobe-static");
const ffprobe = process.env.FFPROBE_PATH || probe.path;
try {
  execFileSync(
    ffmpeg,
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1024x1024",
      "-frames:v",
      "1",
      path.join(dir, "frame.png"),
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    ffmpeg,
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1280x720:r=24",
      "-t",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      path.join(dir, "source.mp4"),
    ],
    { stdio: "ignore" },
  );
  if((process.env.TEST_TRANSFER === '1' || process.env.TEST_DEFER === '1'))await fs.appendFile(path.join(dir,'source.mp4'),Buffer.alloc(11*1024*1024));
  const out = execFileSync(
    process.execPath,
    [
      "--import",
      path.join(root, "tests/mock-recovery-provider.mjs"),
      path.join(root, "services/worker.mjs"),
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        OPENAI_API_KEY: "test-only",
        HF_KEY: "test-only",
        WORKER_SECRET: "test-only",
        WORKER_SITES_TOKEN: "",
        WORKER_APP_URL: "http://worker.test",
        ORCHESTRATOR_MODEL: "gpt-6-astra",
        FFMPEG_PATH: ffmpeg,
        FFPROBE_PATH: ffprobe,
      },
      timeout: 90000,
      encoding: "utf8",
    },
  );
  const { project: p, counters: c } = JSON.parse(
    await fs.readFile(path.join(dir, "result.json"), "utf8"),
  );
  if (process.env.TEST_DEFER === '1') {
    assert.equal(p.status,'queued',p.error || out);assert.equal(c.video,0);assert.equal(c.images,0);
    assert.equal(c.partAttempts['1'],3);assert.equal(p.clips[1].recovery.video.attempts[0].status,'complete');
    console.log('PASS: real renderer schedules durable automatic recovery after exhausted transfers, without a failed production or extra generations.');
  } else {
  assert.equal(p.status, "complete", p.error || out);
  const resumed = process.env.TEST_RESUME_POLLING === "1" || process.env.TEST_TRANSFER === "1";
  assert.equal(c.video, resumed ? 0 : 2);
  assert.equal(c.images, resumed ? 0 : 2);
  assert.equal(c.rewrites, resumed ? 0 : 2);
  assert.equal(
    p.clips[0].recovery,
    undefined,
    "completed clip must not be regenerated",
  );
  if (resumed) {
    assert.equal(p.clips[1].recovery.video.attempts.length, 1);
    assert.equal(p.clips[1].recovery.video.attempts[0].status, "complete");
  } else {
    assert.equal(p.clips[1].recovery.video.attempts[0].status, "rejected");
    assert.equal(p.clips[1].recovery.video.attempts[1].status, "complete");
  }
  assert.ok(c.uploads.includes("recovery-fixture/movie.mp4"));
  const info = JSON.parse(
    execFileSync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_format",
        "-of",
        "json",
        path.join(dir, "worker-state/recovery-fixture/movie.mp4"),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.ok(Math.abs(Number(info.format.duration) - 60) < 0.5);
  if(process.env.TEST_TRANSFER === '1'){
    assert.equal(c.partAttempts['1'],2);assert.equal(c.partAttempts['2'],1);assert.equal(c.partAttempts['3'],1);assert.equal(c.completionChecks,1);
    console.log('PASS: multipart timeout retries same part, lost completion response reconciles stored object, existing completed video reused with zero paid calls.');
  }
  console.log(
    resumed ? "PASS: 24-hour-old saved request with an alternate status host resumes via canonical API, completes assembly, and makes ZERO generation or rewrite submissions." : "PASS: recovery handles alternate/missing status URLs, replacements, saved clips, and 60-second assembly. Zero external requests.",
  );
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
