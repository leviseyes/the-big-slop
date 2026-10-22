import { AppError, bucket, db, failure, getProject, identity } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await identity();
    const u = new URL(req.url),
      key = u.searchParams.get("key") || "";
    const [id] = key.split("/");
    const { project: p } = await getProject(id, user);
    if (
      !/\.(png|jpe?g|webp|gif|avif)$/i.test(key) &&
      ![
        ...p.assets.flatMap((a: any) => [a.imageKey, a.editSourceKey]),
        ...p.clips.flatMap((c: any) => [c.videoKey,c.frameKey,...(c.storyboard || []).map((s:any)=>s.imageKey)]),
        p.outputKey,
      ].includes(key)
    ) {
      const reference=await db().prepare("SELECT 1 FROM series_assets a JOIN series s ON s.id=a.series_id WHERE s.owner=? AND json_extract(a.data,'$.imageKey')=? LIMIT 1").bind(user,key).first();
      const snapshot=reference || await db().prepare("SELECT 1 FROM productions p,json_each(p.data,'$.assets') a WHERE p.owner=? AND (json_extract(a.value,'$.imageKey')=? OR json_extract(a.value,'$.editSourceKey')=?) LIMIT 1").bind(user,key,key).first();
      if(!snapshot) throw new AppError("Media not found.", 404);
    }
    const object = await bucket().get(key, { range: req.headers });
    if (!object) throw new AppError("Media not found.", 404);
    const headers = new Headers({
      "Content-Type":
        object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });
    let status = 200;
    if (req.headers.has("range") && object.range && "offset" in object.range) {
      const start = object.range.offset || 0,
        len = object.range.length || object.size;
      headers.set(
        "Content-Range",
        `bytes ${start}-${start + len - 1}/${object.size}`,
      );
      headers.set("Content-Length", String(len));
      status = 206;
    } else headers.set("Content-Length", String(object.size));
    if (u.searchParams.has("download"))
      headers.set(
        "Content-Disposition",
        `attachment; filename="${/\.(png|jpe?g|webp|gif|avif)$/i.test(key) ? key.split("/").pop()!.replace(/[^a-zA-Z0-9._-]/g,"_") : "the-big-slop.mp4"}"`,
      );
    return new Response(object.body, { status, headers });
  } catch (e) {
    return failure(e);
  }
}
