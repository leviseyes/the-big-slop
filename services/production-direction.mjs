import { storyboardProperty } from "./seedance-storyboard.mjs";
export const DIALOGUE_LANGUAGES = ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Japanese", "Korean", "Mandarin Chinese", "Arabic", "Hindi", "Hebrew"];
export const VIDEO_RESOLUTIONS = ["480p", "720p"];
export const CONTINUITY_GUIDE_LIMIT = 5000;
export const validContinuityGuide = value => typeof value === "string" && !!value.trim() && value.length <= CONTINUITY_GUIDE_LIMIT;

// The saved film guide is authoritative. A later section must never replace it
// with a longer or contradictory retelling of the same production.
export async function prepareContinuityGuide(project, { repair, checkpoint }) {
  const pending = project.pendingPlan;
  if (!pending?.plan) throw new Error("No saved planning section to recover.");
  if (validContinuityGuide(project.productionBible)) {
    pending.plan.productionBible = project.productionBible;
    return;
  }
  if (!project.productionBible && validContinuityGuide(pending.plan.productionBible)) return;
  pending.continuityRepair ??= { original: project.productionBible || pending.plan.productionBible || "", attempts: 0 };
  const state = pending.continuityRepair;
  while (state.attempts < 2) {
    project.phase = "Refining the film continuity guide. Your script and completed planning are saved.";
    await checkpoint();
    // The caller uses a durable request keyed by section and attempt, so a
    // disconnected repair is polled again rather than charged twice.
    const guide = await repair(state.original, state.attempts, pending.plan);
    state.attempts++;
    if (validContinuityGuide(guide)) {
      pending.plan.productionBible = guide.trim();
      project.productionBible = guide.trim();
      await checkpoint();
      return;
    }
    await checkpoint();
  }
  throw new Error("The continuity guide could not be finalized automatically. Your script and completed planning are saved.");
}

export function canResumeContinuityPlanning(p) {
  return p.status === "failed" && p.error === "The director must provide a concise continuity guide." &&
    p.workStage === "planning" && p.pendingPlan?.section === p.planChunks && !!p.pendingPlan?.plan &&
    validContinuityGuide(p.productionBible) && !p.runtimeApprovedAt && !p.paidAt && !p.generationAuthorization &&
    !p.clips.some(c => c.requestId || c.videoKey || c.frameKey) && !p.assets.some(a => a.imageKey);
}

export function productionSettings(project = {}) {
  if (typeof project === "string" || Array.isArray(project)) project = { dialogueLanguages: Array.isArray(project) ? project : [project] };
  const dialogueLanguages = project.dialogueLanguages ?? [project.dialogueLanguage || "English"];
  const textLanguages = project.textLanguages ?? [];
  for (const values of [dialogueLanguages, textLanguages]) {
    if (!Array.isArray(values) || values.length > DIALOGUE_LANGUAGES.length || new Set(values).size !== values.length || values.some(v => !DIALOGUE_LANGUAGES.includes(v)))
      throw new Error("Choose supported dialogue and on-screen text languages.");
  }
  const resolution = project.resolution || "720p";
  if (!VIDEO_RESOLUTIONS.includes(resolution)) throw new Error("Choose native 480p or 720p. Seedance 2.5 does not support 1080p yet.");
  return { dialogueLanguages, textLanguages, resolution, languageNotes: project.languageNotes || "" };
}

export function videoDimensions(resolution = "720p") {
  const sizes = { "480p": [854, 480], "720p": [1280, 720] };
  if (!sizes[resolution]) throw new Error("Unsupported output resolution.");
  const [width, height] = sizes[resolution];
  const generationResolution = resolution;
  const [sourceWidth, sourceHeight] = sizes[generationResolution];
  return { width, height, generationResolution, sourceWidth, sourceHeight };
}

export function dialogueInstruction(value = "English") {
  const languages = productionSettings(value).dialogueLanguages;
  if (!languages.length) return "SPOKEN AUDIO: NONE. No dialogue, narration, background voices or sung lyrics. Use non-vocal ambience and sound effects only.";
  return `SPOKEN AUDIO LANGUAGE: ${languages.join(", ")} ONLY. Speak the supplied dialogue verbatim, with natural pronunciation. Follow each line's assigned language and speaker; never arbitrarily switch languages or add translations. Keep each character's voice, accent and delivery consistent throughout the film. Do not invent speech or gibberish. If there is no scripted dialogue, use non-vocal ambience and sound effects only. This requirement applies regardless of visual style, setting or appearance.`;
}

export function textInstruction(value = {}) {
  const languages = productionSettings(value).textLanguages;
  return languages.length
    ? `ON-SCREEN TEXT LANGUAGES: ${languages.join(", ")} ONLY. Render only the exact scripted text specified for this shot (signs, screens, titles or explicitly requested subtitles), in its assigned language and placement. Preserve spelling and typography across shots. Do not invent captions, subtitles, logos, extra words or gibberish. If no text is specified, keep readable text out of frame.`
    : "ON-SCREEN TEXT: NONE. No readable signs, screen text, titles, captions, subtitles, logos or lettering. Use blank surfaces or frame text out.";
}

// A repeated location alone does not imply a matching shot. Every continuity
// key must agree, and the director must explicitly request a continuation.
export function continuesPreviousShot(clip, previous) {
  return !!previous && clip.transition === "continue" && ["sceneId", "locationId", "cameraId", "timeOfDay"].every(k => {
    const endKey = "end" + k[0].toUpperCase() + k.slice(1);
    return typeof clip[k] === "string" && clip[k].trim() && clip[k] === (previous[endKey] || previous[k]);
  });
}

export function shotPrompt(clip, assets, project = {}) {
  const references = (clip.assetIds || []).map(id => assets.find(a => a.id === id)).filter(Boolean);
  return [
    clip.prompt,
    `FILM STYLE: ${project.style || "Cinematic"}. ${project.productionBible || "Maintain consistent lighting, color grade, wardrobe, voices and physical proportions."}`,
    references.length ? `FIXED IDENTITIES AND SET: ${references.map(a => `${a.id} (${a.name}): ${a.description}`).join("; ")}` : "",
    clip.sceneId ? `SHOT OPENING: scene ${clip.sceneId}; location ${clip.locationId}; camera setup ${clip.cameraId}; time ${clip.timeOfDay}. SHOT ENDING: scene ${clip.endSceneId || clip.sceneId}; location ${clip.endLocationId || clip.locationId}; camera ${clip.endCameraId || clip.cameraId}; time ${clip.endTimeOfDay || clip.timeOfDay}.` : "",
    clip.openingState ? `OPENING STATE: ${clip.openingState}\nACTION AND TIMING: ${clip.actionBeats}\nCLOSING STATE: ${clip.closingState}` : "",
    clip.dialogue ? `EXACT DIALOGUE (speaker, language, delivery, line): ${JSON.stringify(clip.dialogue)}` : "",
    clip.renderedText ? `EXACT ON-SCREEN TEXT (language, placement, text): ${JSON.stringify(clip.renderedText)}` : "",
    "CONTINUITY: Preserve character identity, wardrobe, prop ownership, screen direction, eyelines, lighting and spatial geography. Keep movement physically plausible. Use deliberate, simple blocking, stable composition and only the camera changes specified. Do not add characters, actions or dialogue.",
  ].filter(Boolean).join("\n\n");
}

export function validateDirection(plan, project, previousClips = []) {
  const settings = productionSettings(project);
  if (!validContinuityGuide(plan.productionBible)) throw new Error("The director must provide a concise continuity guide.");
  let previous = previousClips.at(-1);
  for (const c of plan.clips) {
    for (const key of ["sceneId", "locationId", "cameraId", "timeOfDay", "endSceneId", "endLocationId", "endCameraId", "endTimeOfDay", "transitionReason", "openingState", "closingState", "actionBeats"])
      if (typeof c[key] !== "string" || !c[key].trim() || c[key].length > 3000) throw new Error(`The shot plan is missing valid ${key}.`);
    if (!["continue", "cut"].includes(c.transition)) throw new Error("The shot plan needs a cut or continuation decision.");
    if (!Array.isArray(c.dialogue) || !Array.isArray(c.renderedText)) throw new Error("The shot plan needs dialogue and on-screen text lists.");
    for (const line of c.dialogue)
      if (!settings.dialogueLanguages.includes(line.language) || !line.speaker?.trim() || !line.text?.trim() || typeof line.delivery !== "string") throw new Error("Planned dialogue does not match the selected languages.");
    for (const label of c.renderedText)
      if (!settings.textLanguages.includes(label.language) || !label.text?.trim() || !label.placement?.trim()) throw new Error("Planned on-screen text does not match the selected languages.");
    if (!continuesPreviousShot(c, previous)) {
      if (c.transition === "continue") c.transitionReason = previous ? "Scene, location, time or camera setup changes; use a fresh scene frame." : "Opening shot of the film.";
      c.transition = "cut";
    }
    previous = c;
  }
  return plan;
}

export const directionProperties = {
  storyboard: storyboardProperty,
  sceneId: { type: "string" }, locationId: { type: "string" }, cameraId: { type: "string" }, timeOfDay: { type: "string" },
  endSceneId: { type: "string" }, endLocationId: { type: "string" }, endCameraId: { type: "string" }, endTimeOfDay: { type: "string" },
  transition: { type: "string", enum: ["continue", "cut"] }, transitionReason: { type: "string" },
  openingState: { type: "string" }, closingState: { type: "string" }, actionBeats: { type: "string" },
  dialogue: { type: "array", items: { type: "object", additionalProperties: false, required: ["speaker", "language", "text", "delivery"], properties: { speaker: { type: "string" }, language: { type: "string", enum: DIALOGUE_LANGUAGES }, text: { type: "string" }, delivery: { type: "string" } } } },
  renderedText: { type: "array", items: { type: "object", additionalProperties: false, required: ["language", "text", "placement"], properties: { language: { type: "string", enum: DIALOGUE_LANGUAGES }, text: { type: "string" }, placement: { type: "string" } } } },
};
