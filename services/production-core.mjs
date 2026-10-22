import { REFERENCE_VIDEO_MODEL, referenceManifest, seedancePrompt } from "./seedance-storyboard.mjs";
import { boardsApproved } from "./storyboard-review.mjs";
export const IMAGE_MODEL = "gpt-image-2.5-sunburst";
export const VIDEO_MODEL = "bytedance/seedance-2.5/image-to-video";
import { dialogueInstruction, textInstruction, productionSettings, videoDimensions, shotPrompt, directionProperties } from "./production-direction.mjs";
export { DIALOGUE_LANGUAGES, dialogueInstruction } from "./production-direction.mjs";
// Derive status routes from the durable ID, as the official SDK does. Never
// send credentials to a host or arbitrary path supplied in a response URL.
export function videoStatusEndpoint(requestId) {
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(requestId))
    throw new Error("Invalid provider request ID; operator review required.");
  return `requests/${requestId}/status`;
}
export function scriptBlocks(script) {
  const parts = script
      .trim()
      .split(/\n\s*\n/)
      .filter(Boolean),
    blocks = [];
  for (const p of parts) {
    const words = p.split(/\s+/);
    for (let i = 0; i < words.length; i += 55)
      blocks.push({
        id: blocks.length,
        text: words.slice(i, i + 55).join(" "),
      });
  }
  return blocks;
}
export function chunksOf(blocks, maxCharacters = 6500) {
  const chunks = [];
  let current = [],
    length = 0;
  for (const b of blocks) {
    if (length + b.text.length > maxCharacters && current.length) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(b);
    length += b.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
export function validatePlan(plan, blocks) {
  if (
    !plan ||
    !Array.isArray(plan.assets) ||
    !Array.isArray(plan.clips) ||
    !plan.clips.length
  )
    throw new Error("The director returned an empty plan.");
  const expected = blocks.map((b) => b.id),
    actual = plan.clips.flatMap((c) => c.blockIds);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      "Script coverage check failed. No generation started: some passages were omitted, duplicated, or reordered.",
    );
  for (const c of plan.clips) {
    if (!c.prompt?.trim() || !c.assetIds?.length)
      throw new Error("A shot is missing its prompt or visual references.");
  }
  return plan;
}
export function videoModelForClip(clip) { return clip.storyboard?.length ? REFERENCE_VIDEO_MODEL : VIDEO_MODEL; }
export function clipBody(clip, assets, project = {}, revisedPrompt) {
  if (!clip.frameUrl) throw new Error("The scene frame is not ready.");
  const settings = productionSettings(project);
  if (clip.storyboard?.length && revisedPrompt) {
    const manifest = referenceManifest(clip, assets);
    const tags = [...revisedPrompt.matchAll(/@image(\d+)\b/gi)].map(m=>Number(m[1]));
    if (tags.some(n=>n<1 || n>manifest.length) || manifest.some((_,i)=>!tags.includes(i+1)))
      throw new Error("Revised video prompt has missing or unbound image references. Production paused before submission.");
  }
  return {
    prompt:
      (clip.storyboard?.length ? (revisedPrompt ?? seedancePrompt(clip, assets, project)) : (revisedPrompt ?? shotPrompt(clip, assets, typeof project === "object" ? project : {}))) +
      "\nPreserve character identities, wardrobe, location and props from the first frame.\n" + dialogueInstruction(settings) + "\n" + textInstruction(settings) +
      (clip.startFrameSource === "previous-clip" ? "\nThe supplied image is the actual final frame of the preceding clip. Start exactly from it; continue the action without resetting poses, props, lighting or camera. Do not replay the preceding dialogue or action." : "\nBegin with the supplied scene frame and the planned opening composition."),
    duration: 30,
    resolution: videoDimensions(settings.resolution).generationResolution,
    output_format: "mp4",
    generate_audio: true,
    ...(clip.storyboard?.length ? {image_urls: referenceManifest(clip, assets).map(r=>r.url), aspect_ratio:"16:9"} : {image_url: clip.frameUrl}),
  };
}
export function estimateUsd(result, input = { resolution: "720p", duration: 30 }) {
  if (result?.usd !== undefined) {
    if (!["number","string"].includes(typeof result.usd) || !Number.isFinite(Number(result.usd)) || Number(result.usd)<=0) throw new Error("Provider returned an invalid price.");
    return Number(result.usd);
  }
  const description = result.pricing_description || "";
  // Reviewed against Higgsfield's estimate API and model pricing on 2026-10-20.
  // Match the whole current tariff: an unrelated rate or formula change must
  // still fail closed. Reference images/audio add no billable video duration.
  const currentDescription = "For 16:9 video without video input, your request costs roughly $0.2056 per second of generated video at 480p, $0.4622 at 720p, and $1.1372 at 1080p. Each 1,000 video tokens costs $0.0214 at 480p or 720p and $0.0234 at 1080p. If video inputs are provided, the token rate is multiplied by 0.6: $0.01284 per 1,000 tokens at 480p or 720p and $0.01404 at 1080p. Both input and generated video durations are billable. Billable video tokens = ceil(output height × output width × (input video duration + generated video duration) × 24 / 1024). Image and audio references do not count as video input. Actual pricing depends on output dimensions and billable duration. Rates shown are before any applicable customer discount.";
  const normalize = text => text.replace(/\s+/g," ").trim();
  if (
    result.type === "description" &&
    (normalize(description) === currentDescription ||
      (description.includes("$0.0214") && description.includes("24 fps / 1024")))
  ) {
    if (input.video_urls?.length || input.video_url || (input.aspect_ratio && input.aspect_ratio!=="16:9")) throw new Error("Video references or a different aspect ratio require a verified provider price.");
    const { sourceWidth, sourceHeight } = videoDimensions(input.resolution);
    if (input.duration !== 30) throw new Error("Unexpected clip duration for pricing.");
    return (Math.ceil((30 * sourceWidth * sourceHeight * 24) / 1024) / 1000) * 0.0214;
  }
  throw new Error(
    "Unrecognized provider pricing. An operator must review the rate before quoting.",
  );
}
export function assertQuoteReady(p) {
  if(p.paidAt || p.generationAuthorization || p.checkoutId || !p.referencesApprovedAt || !p.storyboardsApprovedAt || !boardsApproved(p) || !p.assets?.length || p.assets.some(a=>!a.imageKey || !a.referenceUrl) || p.clips.some(c=>!c.frameKey || !c.frameUrl || c.requestId || c.videoKey))
    throw new Error("Quote recovery requires approved, completed images and no committed video generation.");
}
export function resumePricingQuote(p) {
  if(p.status!=="failed" || p.error!=="Unrecognized provider pricing. An operator must review the rate before quoting.") throw new Error("This production is not paused for pricing review.");
  assertQuoteReady(p);
  return {...p,status:"preparing",workStage:"quote",error:undefined,failedOperation:undefined,quote:undefined,phase:"Recalculating the video estimate. All completed images are preserved."};
}
export function quoteFrom(usdAmounts, markup = 20, now = Date.now()) {
  if (
    !usdAmounts.length ||
    usdAmounts.some((v) => !Number.isFinite(Number(v)) || Number(v) <= 0)
  )
    throw new Error("Provider returned an invalid price.");
  if (!Number.isFinite(markup) || markup < 0 || markup > 500)
    throw new Error("Invalid platform pricing configuration.");
  const providerCents = Math.ceil(
    usdAmounts.reduce((sum, v) => sum + Number(v), 0) * 100,
  );
  const serviceCents = Math.ceil((providerCents * markup) / 100);
  return {
    id: crypto.randomUUID(),
    providerCents,
    serviceCents,
    totalCents: providerCents + serviceCents,
    markupPercent: markup,
    expiresAt: now + 60 * 60 * 1000,
    createdAt: now,
  };
}
export function canSubmit(clip) {
  if (clip.requestId) return false;
  if (clip.status === "submitting")
    throw new Error(
      "A provider submission has an uncertain outcome. Operator reconciliation is required before resuming to prevent duplicate charges.",
    );
  return !clip.videoKey;
}
export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assets", "clips", "productionBible"],
  properties: {
    productionBible: { type: "string" },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "kind", "description", "prompt"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: ["character", "location", "object"] },
          description: { type: "string" },
          prompt: { type: "string" },
        },
      },
    },
    clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["blockIds", "assetIds", "prompt", ...Object.keys(directionProperties)],
        properties: {
          ...directionProperties,
          blockIds: { type: "array", items: { type: "integer" } },
          assetIds: { type: "array", items: { type: "string" } },
          prompt: { type: "string" },
        },
      },
    },
  },
};
