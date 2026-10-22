import { z } from "zod";
import {
  AppError,
  bucket,
  db,
  failure,
  getProject,
  identity,
  json,
  originCheck,
} from "@/lib/server";
export const dynamic = "force-dynamic";
const entry = z.object({
  uploadId: z.string().uuid(),
  assetId: z.string().max(100).optional(),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["character", "location", "object"]),
  description: z.string().trim().min(3).max(2000),
  clipIds:z.array(z.string()).max(720).default([]),
});
export async function POST(req: Request) {
  const stored: string[] = [];
  let committed = false,
    mutationStarted = false;
  try {
    originCheck(req);
    const owner = await identity();
    if (Number(req.headers.get("content-length")) > 55 * 1024 * 1024)
      throw new AppError(
        "Upload at most 10 images per batch, up to 5 MB each.",
        413,
      );
    const form = await req.formData(),
      id = z.string().uuid().parse(form.get("id"));
    const parsed = z
      .array(entry)
      .min(1)
      .max(10)
      .safeParse(JSON.parse(String(form.get("references") || "[]")));
    if (!parsed.success)
      throw new AppError("Give each image a name, type and description.");
    const entries = parsed.data,
      row = await getProject(id, owner),
      p = row.project;
    if (
      !["references_ready", "storyboards_ready", "ready"].includes(p.status) ||
      p.paidAt ||
      p.generationAuthorization ||
      p.checkoutId
    )
      throw new AppError(
        "Wait until all reference images have been generated. You can then replace or add images before pressing Done.",
        409,
      );
    const ids = entries.map((e) => e.assetId || `upload-${e.uploadId}`);
    if (
      new Set(ids).size !== ids.length ||
      new Set(entries.map((e) => e.uploadId)).size !== entries.length
    )
      throw new AppError("Choose each reference only once.");
    if (
      entries.some(
        (e) => e.assetId && !p.assets.some((a: any) => a.id === e.assetId),
      )
    )
      throw new AppError("Reference not found.", 404);
    if(entries.some(e=>!e.assetId && (!e.clipIds.length || e.clipIds.some(id=>!p.clips.some((c:any)=>c.id===id))))) throw new AppError("Choose which clips should use each new reference.");
    if (p.assets.length + entries.filter((e) => !e.assetId).length > 500)
      throw new AppError("This production has reached its reference limit.");
    // Read and validate every image before storing or changing any project state.
    const images = await Promise.all(
      entries.map(async (e) => {
        const file = form.get(e.uploadId);
        if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
          throw new AppError(
            "Each image must be a PNG of at most 5 MB. Re-select the original image to convert it.",
          );
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (
          bytes.length < 33 ||
          ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) ||
          String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
        )
          throw new AppError(
            "Invalid reference image. Choose a PNG, JPEG or WebP image again.",
          );
        const v = new DataView(bytes.buffer),
          w = v.getUint32(16),
          h = v.getUint32(20);
        if (!w || !h || w > 1024 || h > 1024)
          throw new AppError(
            "Reference uploads must be resized to a maximum of 1024 pixels per side.",
          );
        return bytes;
      }),
    );
    const next = structuredClone(p);
    const affected=new Set(entries.flatMap(e=>e.assetId?p.clips.filter((c:any)=>c.assetIds.includes(e.assetId)).map((c:any)=>c.id):e.clipIds));
    for(const [i,e] of entries.entries()) if(!e.assetId) for(const c of next.clips) if(e.clipIds.includes(c.id)) {c.assetIds.push(ids[i]);if(c.assetIds.length>16)throw new AppError("A clip can use up to 16 asset references. Choose fewer references for that clip.");}
    for(const c of next.clips) if(affected.has(c.id)) {c.frameRevision=(c.frameRevision||0)+1;delete c.frameKey;delete c.frameUrl;delete c.plannedFrameUrl;delete c.input;if(c.recovery)delete c.recovery.frame;for(const shot of c.storyboard||[]) {delete shot.imageKey;delete shot.referenceUrl;delete shot.recovery;}}
    next.status="references_ready";next.referencesApprovedAt=undefined;next.quote=undefined;next.progress=undefined;
    next.phase="Your uploaded images are saved. Continue editing, then press Done to build storyboards.";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i],
        key = `${p.id}/uploads/${crypto.randomUUID()}.png`;
      await bucket().put(key, images[i], {
        httpMetadata: { contentType: "image/png" },
      });
      stored.push(key);
      const old = next.assets.find((a: any) => a.id === ids[i]);
      const asset = {
        ...old,
        id: ids[i],
        name: old?.name || e.name,
        kind: old?.kind || e.kind,
        description: e.description,
        prompt: `${old?.name || e.name}. ${e.description}. Follow the supplied reference image.`,
        imageKey: key,
        source: "upload",
        status: "stored",
        referenceUrl: undefined,
        editSourceKey: undefined,
        editInstructions: undefined,
        recovery: undefined,
      };
      if (old)
        next.assets = next.assets.map((a: any) =>
          a.id === asset.id ? asset : a,
        );
      else next.assets.push(asset);
    }
    const data = JSON.stringify(next),
      now = Date.now();
    const statements = [
      db()
        .prepare(
          "UPDATE productions SET data=?,status=?,version=version+1,updated=? WHERE id=? AND owner=? AND version=? AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))",
        )
        .bind(data, next.status, now, p.id, owner, row.version, p.id),
    ];
    mutationStarted = true;
    const results = await db().batch(statements);
    if (!results[0].meta.changes) {
      mutationStarted = false;
      throw new AppError(
        "The production changed during upload. Refresh and try again.",
        409,
      );
    }
    committed = true;
    return json({ project: next });
  } catch (e) {
    if (!committed && !mutationStarted && stored.length)
      await Promise.allSettled(stored.map((key) => bucket().delete(key)));
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return json(
        { error: "Check the reference names, types and descriptions." },
        400,
      );
    return failure(e);
  }
}
