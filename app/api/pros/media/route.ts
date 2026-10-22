import { AppError, bucket, failure } from "@/lib/server";
import { proUser, proVideo } from "@/lib/pros";
export const dynamic="force-dynamic";
export async function GET(req:Request) {
  try {
    const user=await proUser(),row=await proVideo(new URL(req.url).searchParams.get("id") || "");
    if(!["pending","approved","rejected"].includes(row.status) || (row.status!=="approved" && row.owner!==user.userId && !user.admin)) throw new AppError("Video not found.",404);
    const object=await bucket().get(row.media_key,{range:req.headers});
    if(!object) throw new AppError("Video not found.",404);
    const headers=new Headers({"Content-Type":row.content_type,"Cache-Control":"private, no-store","Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff"});
    let status=200;
    if(req.headers.has("range") && object.range && "offset" in object.range) {
      const start=object.range.offset || 0,len=object.range.length || object.size;
      headers.set("Content-Range",`bytes ${start}-${start+len-1}/${object.size}`); headers.set("Content-Length",String(len));status=206;
    } else headers.set("Content-Length",String(object.size));
    return new Response(object.body,{status,headers});
  } catch(e) {return failure(e);}
}
