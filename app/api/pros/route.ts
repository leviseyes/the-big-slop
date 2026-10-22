import { z } from "zod";
import { AppError, bucket, db, failure, json, originCheck } from "@/lib/server";
import { MAX_VIDEO_BYTES, PART_BYTES, proUser, proVideo, publicVideo } from "@/lib/pros";
import { CATEGORIES } from "@/services/production-categories.mjs";
export const dynamic = "force-dynamic";
const uuid = z.string().uuid();
export async function POST(req: Request) {
  try {
    originCheck(req);
    const user = await proUser(), b = await req.json() as any;
    if (b.action === "list") {
      const page = z.number().int().min(0).max(100000).default(0).parse(b.page);
      const scope = z.enum(["gallery","mine","review"]).default("gallery").parse(b.scope);
      if (scope === "review" && !user.admin) throw new AppError("Admin access required.",403);
      const category = z.string().max(80).default("All").parse(b.category), query = z.string().max(200).default("").parse(b.query);
      const where = scope === "gallery" ? "status='approved'" : scope === "mine" ? "owner=?" : "status IN ('pending','approved','rejected')";
      const rows = await db().prepare(`SELECT * FROM pro_videos WHERE ${where} AND (?='All' OR category=?) AND (?='' OR instr(lower(title || ' ' || creator),lower(?))>0) ORDER BY created DESC LIMIT 25 OFFSET ?`)
        .bind(...(scope === "mine" ? [user.userId] : []),category,category,query,query,page*24).all<any>();
      return json({isAdmin:user.admin,hasMore:rows.results.length>24,videos:rows.results.slice(0,24).map(r=>publicVideo(r,scope!=="gallery"))});
    }
    if (b.action === "start") {
      const data = z.object({title:z.string().trim().min(1).max(120),description:z.string().trim().max(2000),
        creator:z.string().trim().min(1).max(100),category:z.string().refine(c=>CATEGORIES.includes(c)),
        contentType:z.enum(["video/mp4","video/webm"]),bytes:z.number().int().min(32).max(MAX_VIDEO_BYTES),
        duration:z.number().finite().positive().max(86400), rights:z.literal(true)}).parse(b);
      const id=crypto.randomUUID(),key=`pros/${id}/film`,now=Date.now();
      const upload=await bucket().createMultipartUpload(key,{httpMetadata:{contentType:data.contentType}});
      try {
        const result=await db().prepare("INSERT INTO pro_videos(id,owner,title,description,category,creator,status,media_key,upload_id,content_type,bytes,duration,created,updated) SELECT ?,?,?,?,?,?,'uploading',?,?,?,?,?,?,? WHERE (SELECT count(*) FROM pro_videos WHERE owner=? AND status IN ('uploading','finalizing','pending'))<10")
          .bind(id,user.userId,data.title,data.description,data.category,data.creator,key,upload.uploadId,data.contentType,data.bytes,Math.max(1,Math.round(data.duration)),now,now,user.userId).run();
        if (!result.meta.changes) throw new AppError("You can have up to 10 uploads awaiting completion or review. Finish or cancel an existing upload first.",409);
      } catch(e) { await upload.abort(); throw e; }
      return json({id,partBytes:PART_BYTES});
    }
    const row=await proVideo(uuid.parse(b.id));
    if (b.action === "review") {
      if (!user.admin) throw new AppError("Admin access required.",403);
      const status=z.enum(["approved","rejected"]).parse(b.status),note=z.string().trim().max(2000).default("").parse(b.note);
      const result=await db().prepare("UPDATE pro_videos SET status=?,review_note=?,reviewed_by=?,updated=? WHERE id=? AND status IN ('pending','approved','rejected') AND updated=?")
        .bind(status,note,user.userId,Date.now(),row.id,z.number().int().parse(b.updated)).run();
      if(!result.meta.changes) throw new AppError("This submission changed. Refresh the review queue.",409);
      return json({ok:true});
    }
    if(row.owner!==user.userId) throw new AppError("Video not found.",404);
    if(b.action==="cancel") {
      const result=await db().prepare("UPDATE pro_videos SET status='cancelled',updated=? WHERE id=? AND status='uploading'").bind(Date.now(),row.id).run();
      if(!result.meta.changes) throw new AppError("Only an unfinished upload can be cancelled.",409);
      await bucket().resumeMultipartUpload(row.media_key,row.upload_id).abort();
      await db().prepare("DELETE FROM pro_video_parts WHERE video_id=?").bind(row.id).run();
      return json({ok:true});
    }
    if(b.action==="finish") {
      if(["pending","approved","rejected"].includes(row.status)) return json({ok:true});
      if(!["uploading","finalizing"].includes(row.status)) throw new AppError("This upload is no longer active.",409);
      const parts=(await db().prepare("SELECT * FROM pro_video_parts WHERE video_id=? ORDER BY part_number").bind(row.id).all<any>()).results;
      if(parts.length!==Math.ceil(row.bytes/PART_BYTES) || parts.some((p,i)=>p.part_number!==i+1 || p.bytes!==Math.min(PART_BYTES,row.bytes-i*PART_BYTES))) throw new AppError("Some video parts are missing. Resume the upload before submitting.",409);
      await db().prepare("UPDATE pro_videos SET status='finalizing' WHERE id=? AND status='uploading'").bind(row.id).run();
      // A previous complete call may have succeeded before the connection was lost.
      let object=await bucket().head(row.media_key);
      if(!object) { await bucket().resumeMultipartUpload(row.media_key,row.upload_id).complete(parts.map(p=>({partNumber:p.part_number,etag:p.etag}))); object=await bucket().head(row.media_key); }
      if(!object || object.size!==row.bytes) throw new AppError("Upload verification is not finished. Try submitting again.",503);
      await db().prepare("UPDATE pro_videos SET status='pending',updated=? WHERE id=? AND status='finalizing'").bind(Date.now(),row.id).run();
      return json({ok:true});
    }
    throw new AppError("Unknown video action.");
  } catch(e) { if(e instanceof z.ZodError) return json({error:"Check your video details. Choose an MP4 or WebM up to 5 GB and confirm you have permission to share it."},400); return failure(e); }
}
export async function PUT(req: Request) {
  try {
    originCheck(req);
    const user=await proUser(),url=new URL(req.url),row=await proVideo(uuid.parse(url.searchParams.get("id")));
    if(row.owner!==user.userId) throw new AppError("Video not found.",404);
    if(row.status!=="uploading") throw new AppError("This upload no longer accepts parts.",409);
    const part=z.coerce.number().int().min(1).max(Math.ceil(row.bytes/PART_BYTES)).parse(url.searchParams.get("part"));
    const expected=Math.min(PART_BYTES,row.bytes-(part-1)*PART_BYTES);
    if(Number(req.headers.get("content-length"))!==expected) throw new AppError("Video part has an unexpected size.");
    const bytes=await req.arrayBuffer();
    if(bytes.byteLength!==expected) throw new AppError("Incomplete video part. Please retry.");
    if(part===1) {
      const sig=new Uint8Array(bytes,0,Math.min(12,bytes.byteLength));
      const valid=row.content_type==="video/mp4" ? String.fromCharCode(...sig.slice(4,8))==="ftyp" : sig[0]===0x1a && sig[1]===0x45 && sig[2]===0xdf && sig[3]===0xa3;
      if(!valid) throw new AppError("The file is not a supported MP4 or WebM video.");
    }
    const uploaded=await bucket().resumeMultipartUpload(row.media_key,row.upload_id).uploadPart(part,bytes);
    await db().prepare("INSERT INTO pro_video_parts(video_id,part_number,etag,bytes) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pro_videos WHERE id=? AND status='uploading') ON CONFLICT(video_id,part_number) DO UPDATE SET etag=excluded.etag,bytes=excluded.bytes")
      .bind(row.id,part,uploaded.etag,expected,row.id).run();
    return json({ok:true});
  } catch(e) { if(e instanceof z.ZodError) return json({error:"Invalid upload part."},400); return failure(e); }
}
