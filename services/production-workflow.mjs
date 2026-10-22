import { imageCatalog } from "./image-edit-context.mjs";
import { scriptBlocks, chunksOf } from "./production-core.mjs";
export function targetClipCount(minutes) {
  if (
    !Number.isFinite(minutes) ||
    minutes < 0.5 ||
    minutes > 360 ||
    !Number.isInteger(minutes * 2)
  )
    throw new Error(
      "Choose a runtime from 0.5 to 360 minutes, in 30-second increments.",
    );
  return minutes * 2;
}
export function planningSections(script, minutes) {
  const count = targetClipCount(minutes);
  const original = chunksOf(scriptBlocks(script));
  const n = Math.min(count, original.length);
  if (!n) throw new Error("Add a script before planning.");
  const groups = Array.from({ length: n }, () => []);
  original.forEach((chunk, i) =>
    groups[Math.floor((i * n) / original.length)].push(...chunk),
  );
  const total = groups.reduce((sum, g) => sum + g.length, 0);
  const allocations = groups.map(
    (g) => 1 + Math.floor(((count - n) * g.length) / total),
  );
  for (
    let left = count - allocations.reduce((a, b) => a + b, 0), i = 0;
    left > 0;
    left--, i++
  )
    allocations[i % n]++;
  return groups.map((blocks, i) => ({ blocks, clipCount: allocations[i] }));
}
export function reviseReference(project, assetId, changes) {
  return reviseReferences(project, [{assetId, changes}]);
}
export function reviseReferences(project, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 500 || new Set(edits.map(e=>e.assetId)).size !== edits.length)
    throw new Error("Choose unique reference images to edit.");
  for (const edit of edits) {
    if (!project.assets.some(a=>a.id===edit.assetId && a.imageKey)) throw new Error("Choose a completed reference image.");
    if (typeof edit.changes !== "string" || edit.changes.trim().length < 3 || edit.changes.length > 2000) throw new Error("Describe the changes for every selected image.");
  }
  const catalog = imageCatalog(project);
  for (const edit of edits) {
    const refs=edit.referenceIds || [];
    if(!Array.isArray(refs) || refs.length>15 || new Set(refs).size!==refs.length || refs.some(id=>!catalog.some(r=>r.id===id && r.id!==`asset:${edit.assetId}`))) throw new Error("Choose up to 15 available supporting images for each edit.");
  }
  const next = structuredClone(project);
  next.editReferenceLibrary = catalog;
  const ids = new Set(edits.map(e=>e.assetId));
  for (const edit of edits) {
    const asset = next.assets.find(a=>a.id===edit.assetId);
    asset.revision = (asset.revision || 0) + 1;
    asset.editSourceKey = asset.imageKey;
    asset.editInstructions = edit.changes.trim();
    asset.editReferenceIds = edit.referenceIds || [];
    delete asset.editPlan;
    asset.imageKey = undefined;
    asset.referenceUrl = undefined;
    asset.recovery = undefined;
    asset.status = "planned";
  }
  const affected = next.clips.filter(c=>c.assetIds?.some(id=>ids.has(id)));
  for (const clip of affected) {
    for (const shot of clip.storyboard || []) { delete shot.imageKey; delete shot.referenceUrl; delete shot.recovery; }
    clip.frameRevision = (clip.frameRevision || 0) + 1;
    clip.plannedFrameUrl = undefined;
    clip.startFrameClipId = undefined;
    clip.startFrameSource = undefined;
    clip.frameKey = undefined;
    clip.frameUrl = undefined;
    clip.frameStatus = "planned";
    clip.input = undefined;
    if (clip.recovery) delete clip.recovery.frame;
  }
  next.referencesApprovedAt = undefined;
  next.quote = undefined;
  next.consent = undefined;
  next.generationAuthorization = undefined;
  next.status = "preparing";
  next.phase = `Revising ${edits.length} reference image${edits.length === 1 ? "" : "s"} and rebuilding ${affected.length} affected scene frames.`;
  next.workStage = "references";
  next.progress = undefined;
  return next;
}
// Planning ranges, not provider guarantees. Queueing and retries can add time.
export function stageEstimates(p) {
  const clips = p.clips?.length || (p.targetMinutes || 5) * 2;
  const assets = p.assets?.length || 0;
  return [
    {
      key: "planning",
      label: "Script & shot plan",
      done: p.planChunks || 0,
      total:
        p.planningTotal ||
        Math.max(1, Math.ceil((p.script?.length || 0) / 6500)),
      unitLow: 1,
      unitHigh: 3,
    },
    {
      key: "references",
      label: "Reference images",
      done: (p.assets || []).filter((a) => a.imageKey && a.referenceUrl).length,
      total: assets,
      unitLow: 1,
      unitHigh: 4,
    },
    {
      key: "storyboards", label: "Storyboard panels",
      done: (p.clips || []).flatMap(c=>c.storyboard || []).filter(s=>s.referenceUrl).length,
      total: (p.clips || []).flatMap(c=>c.storyboard || []).length,
      unitLow: 1, unitHigh: 4,
    },
    {
      key: "frames",
      label: "Scene frames",
      done: (p.clips || []).filter((c) => c.frameUrl).length,
      total: clips,
      unitLow: 1,
      unitHigh: 4,
    },
    {
      key: "video",
      label: "Video clips",
      done: (p.clips || []).filter((c) => c.videoKey).length,
      total: clips,
      unitLow: 3,
      unitHigh: 15,
    },
    {
      key: "assembly",
      label: "Final assembly",
      done: p.outputKey ? 1 : 0,
      total: 1,
      unitLow: Math.max(1, Math.ceil(clips / 20)),
      unitHigh: Math.max(3, Math.ceil(clips / 4)),
    },
  ];
}
export function currentProgress(p) {
  if(p.status === "writing") return {key:"writing",label:"Writing your script",done:p.ideaDraft?.parts?.length||0,total:Math.ceil((p.targetMinutes||5)/5),remainingLow:1,remainingHigh:Math.ceil((p.targetMinutes||5)/5)*3};
  const sections = stageEstimates(p);
  let key = p.workStage;
  if (p.status === "planning") key = "planning";
  else if (p.status === "rendering" || p.status === "queued") key = "video";
  else if (p.status === "stitching") key = "assembly";
  else if (p.status === "preparing" && !key)
    key = !p.clips?.length
      ? "planning"
      : sections[1].done < sections[1].total
        ? "references"
        : "frames";
  const step = sections.find((s) => s.key === key) || sections[0];
  return {
    ...step,
    remainingLow: Math.ceil(Math.max(0, step.total - step.done) * step.unitLow),
    remainingHigh: Math.ceil(
      Math.max(0, step.total - step.done) * step.unitHigh,
    ),
  };
}
