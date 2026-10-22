// Seedance reference slots are derived from the exact ordered image_urls payload.
export const REFERENCE_VIDEO_MODEL =
  "bytedance/seedance-2.5/reference-to-video";
export function validateStoryboard(clip) {
  if (!Array.isArray(clip.storyboard) || !clip.storyboard.length)
    throw new Error("Each clip needs a storyboard covering all 30 seconds.");
  let end = 0;
  for (const shot of clip.storyboard) {
    if (
      shot.start !== end ||
      !Number.isFinite(shot.end) ||
      shot.end <= shot.start ||
      shot.end > 30 ||
      !shot.composition?.trim() ||
      !shot.action?.trim() ||
      !shot.audio?.trim()
    )
      throw new Error(
        "Storyboard shots must cover 0–30 seconds in order, without gaps or overlaps.",
      );
    end = shot.end;
  }
  if (end !== 30)
    throw new Error("Storyboard must cover the final second of the clip.");
}
export const storyboardProperty = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["start", "end", "composition", "action", "audio"],
    properties: {
      start: { type: "number" },
      end: { type: "number" },
      composition: { type: "string" },
      action: { type: "string" },
      audio: { type: "string" },
    },
  },
};
export function referenceManifest(clip, assets) {
  const entries = [];
  const add = (id, role, description, url) => {
    if (!url || !/^https:\/\//.test(url))
      throw new Error(`Missing published reference: ${id}`);
    const entry = {
      id,
      role,
      description,
      url,
      tag: `@image${entries.length + 1}`,
    };
    entries.push(entry);
    return entry;
  };
  add(
    "opening",
    "FIRST FRAME / COMPOSITION",
    clip.startFrameSource === "previous-clip"
      ? "Actual final frame of the preceding clip. Continue exactly; do not replay action or dialogue."
      : clip.openingState || "Opening composition",
    clip.frameUrl,
  );

  for (const id of [...new Set(clip.assetIds)]) {
    const a = assets.find((a) => a.id === id);
    if (!a) throw new Error(`Unknown reference identity: ${id}`);
    add(
      id,
      a.kind.toUpperCase() + " AUTHORITY",
      `${a.name}: ${a.description}`,
      a.referenceUrl,
    );
  }
  // Keep screened cast/set/prop authorities; omit rejected scene storyboards.
  if (clip.safetyReplacement) return entries;
  for (const [i, s] of clip.storyboard.entries())
    add(
      `shot-${i + 1}`,
      `STORYBOARD ${s.start}–${s.end}s`,
      s.composition,
      s.referenceUrl,
    );
  return entries;
}
export function seedancePrompt(clip, assets, project, revisedDirection) {
  validateStoryboard(clip);
  const refs = referenceManifest(clip, assets);
  const shots = refs.filter((r) => r.role.startsWith("STORYBOARD"));
  return [
    `REFERENCE LOCK — ${project.title || "Production"} / ${clip.id}\nStoryboard drawings specify composition, blocking and motion only. Do not reproduce pencil strokes, arrows, panel borders or a slideshow; render animated footage in the requested production style. These tags map to the attached images in this request. Stable asset IDs are given separately; never interpret IDs as attachment numbers.\n${refs.map((r) => `${r.tag} — ${r.id} — ${r.role}: ${r.description}`).join("\n")}`,
    "IDENTITY, PRODUCT AND CONTINUITY LOCK\nCharacter references control face, hair, build and wardrobe only; never reproduce reference-sheet panels or duplicate actors. Object references control geometry, scale, material, markings and connections. Location references control geography, furnishings and lighting. Storyboards control composition and blocking, not replacement identities. Preserve prop counts, ownership, hand contact, spatial positions and screen direction across camera changes. No spontaneous objects or wardrobe changes. End-card products belong only to that shot, not earlier scenes.",
    `FORMAT AND PERFORMANCE\n30-second finished sequence, 16:9, ${project.resolution || "720p"}, ${project.style || "Cinematic"}. ${project.productionBible || "Consistent lighting, color grade, lenses and voices."}\nAnimate continuous physical movement, not a slideshow of panels. Only planned cuts. Exact speaker lip-sync; no overlapping lines unless scripted. No invented music, narration, laughter, dialogue, subtitles or logos. Sound follows the shot directions and scripted dialogue.`,
    `OPENING LOCK\nBegin exactly from @image1. ${clip.openingState || ""}\n${clip.transition === "continue" ? "Continue the preceding movement without resetting poses, props or camera." : "Establish the planned new scene/camera setup."}`,
    `DIRECTOR'S SCENE INSTRUCTIONS\n${revisedDirection || clip.prompt}`,
    ...clip.storyboard.map(
      (s, i) =>
        `${String(s.start).padStart(2, "0")}–${String(s.end).padStart(2, "0")} SECONDS — SHOT ${i + 1}\nPrimary composition: ${shots[i].tag}. Identity/set authorities: ${refs
          .filter((r) => !r.role.startsWith("STORYBOARD") && r.id !== "opening")
          .map((r) => r.tag)
          .join(
            ", ",
          )}.\nComposition: ${s.composition}\nAction / performance / camera: ${s.action}\nAudio / dialogue timing: ${s.audio}`,
    ),
    `EXACT DIALOGUE — preserve speaker, language, delivery and wording\n${JSON.stringify(clip.dialogue || [])}`,
    `EXACT VISIBLE TEXT — preserve wording, language and placement; no additions\n${JSON.stringify(clip.renderedText || [])}`,
    `FINAL FRAME / HANDOFF\n${clip.closingState || "Hold the planned closing composition."}\nKeep identities, prop state, eyelines and lighting ready for the next shot.`,
  ].join("\n\n");
}
