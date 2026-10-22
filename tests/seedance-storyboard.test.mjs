import test from "node:test";
import assert from "node:assert/strict";
import {
  validateStoryboard,
  referenceManifest,
  seedancePrompt,
} from "../services/seedance-storyboard.mjs";
import { clipBody, videoModelForClip } from "../services/production-core.mjs";
import {
  reviseReferences,
  stageEstimates,
} from "../services/production-workflow.mjs";
const assets = [
  {
    id: "actor",
    kind: "character",
    name: "Mara",
    description: "Blue coat",
    imageKey: "p/actor.png",
    referenceUrl: "https://media.example/actor.png",
  },
];
const clip = {
  id: "c1",
  assetIds: ["actor"],
  frameUrl: "https://media.example/open.png",
  openingState: "Mara sits left",
  closingState: "Mara stands",
  prompt: "Mara rises",
  dialogue: [],
  renderedText: [],
  storyboard: [
    {
      start: 0,
      end: 10,
      composition: "Wide room",
      action: "Rise",
      audio: "Footsteps",
      imageKey: "p/board0.png",
      referenceUrl: "https://media.example/board0.png",
    },
    {
      start: 10,
      end: 30,
      composition: "Close-up",
      action: "Look up",
      audio: "Silence",
      imageKey: "p/board1.png",
      referenceUrl: "https://media.example/board1.png",
    },
  ],
};
test("reference tags bind actual payload order and preserve every asset and panel", () => {
  const manifest = referenceManifest(clip, assets),
    body = clipBody(clip, assets, { title: "Test", resolution: "480p" });
  assert.deepEqual(
    body.image_urls,
    manifest.map((r) => r.url),
  );
  assert.equal(body.image_url, undefined);
  for (const r of manifest)
    assert.ok(body.prompt.includes(`${r.tag} — ${r.id}`));
  assert.match(body.prompt, /Primary composition: @image3/);
  assert.match(body.prompt, /Primary composition: @image4/);
  assert.equal(body.duration, 30);
  assert.equal(body.aspect_ratio, "16:9");
  assert.match(videoModelForClip(clip), /reference-to-video$/);
  assert.throws(() => clipBody(clip, [], {}), /Unknown reference/);
  assert.throws(
    () =>
      referenceManifest(
        {
          ...clip,
          storyboard: [{ ...clip.storyboard[0], referenceUrl: undefined }],
        },
        assets,
      ),
    /Missing published/,
  );
});
test("storyboard rejects incomplete coverage, gaps, overlap and missing direction", () => {
  validateStoryboard(clip);
  for (const board of [
    [],
    [{ ...clip.storyboard[0], end: 29 }],
    [clip.storyboard[0], { ...clip.storyboard[1], start: 11 }],
    [clip.storyboard[0], { ...clip.storyboard[1], start: 9 }],
    [{ start: 0, end: 30, composition: "", action: "a", audio: "a" }],
  ])
    assert.throws(() => validateStoryboard({ ...clip, storyboard: board }));
});
test("continuation replaces only opening slot, leaving identities and panels bound", () => {
  const continued = {
    ...clip,
    frameUrl: "https://media.example/last.png",
    startFrameSource: "previous-clip",
  };
  const body = clipBody(continued, assets, {});
  assert.equal(body.image_urls[0], continued.frameUrl);
  assert.equal(body.image_urls[1], assets[0].referenceUrl);
  assert.match(body.prompt, /Actual final frame/);
  assert.match(body.prompt, /Do not replay/);
});
test("reference revision invalidates dependent storyboard files and recovery, preserves plan", () => {
  const p = { assets, clips: [clip], status: "ready", quote: {} };
  const revised = reviseReferences(p, [
    { assetId: "actor", changes: "Make coat green" },
  ]);
  assert.equal(revised.clips[0].storyboard[0].imageKey, undefined);
  assert.equal(revised.clips[0].storyboard[0].referenceUrl, undefined);
  assert.equal(revised.clips[0].storyboard[0].composition, "Wide room");
  assert.equal(p.clips[0].storyboard[0].imageKey, "p/board0.png");
  assert.equal(stageEstimates(p).find((s) => s.key === "storyboards").total, 2);
});
test("legacy saved plans keep the existing image-to-video contract", () => {
  const legacy = { ...clip };
  delete legacy.storyboard;
  assert.match(videoModelForClip(legacy), /image-to-video$/);
  assert.equal(clipBody(legacy, assets, {}).image_url, clip.frameUrl);
});

test("revised prompts cannot reference missing attachments or silently drop references",()=>{
 assert.throws(()=>clipBody(clip,assets,{},"Use @image99"),/unbound/);
 assert.throws(()=>clipBody(clip,assets,{},"A room"),/missing/);
 const prompt=seedancePrompt(clip,assets,{});
 assert.ok(clipBody(clip,assets,{},prompt).prompt.includes("REFERENCE LOCK"));
});

test('policy replacements retain identity references but omit rejected storyboards', () => {
  const safe={...clip,safetyReplacement:true,frameUrl:'https://example.com/safe.png',startFrameSource:'replacement-frame'};
  const body=clipBody(safe,assets,{},'Use @image1 for a safe adult conversation. Preserve Mara from @image2.');
  assert.deepEqual(body.image_urls,['https://example.com/safe.png',assets[0].referenceUrl]);
  assert.throws(()=>clipBody(safe,assets,{},'Use @image1 and @image2 and @image3'),/unbound/);
});
