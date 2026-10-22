import { getStudioUser } from "@/app/auth";
import { AppError, config, db } from "@/lib/server";
export const PART_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
export async function proUser() {
  const user = await getStudioUser();
  if (!user) throw new AppError("Sign in to watch or submit videos.", 401);
  // Signed owner session only. Missing configuration grants nobody admin.
  return { ...user, admin: !!config.ADMIN_EMAIL && user.email.toLowerCase() === String(config.ADMIN_EMAIL).trim().toLowerCase() };
}
export async function proVideo(id: string) {
  const row = await db().prepare("SELECT * FROM pro_videos WHERE id=?").bind(id).first<any>();
  if (!row) throw new AppError("Video not found.",404);
  return row;
}
export function publicVideo(row: any, privateView = false) {
  return { id:row.id,title:row.title,description:row.description,category:row.category,creator:row.creator,
    duration:row.duration,status:row.status,created:row.created,updated:row.updated,
    ...(privateView ? {reviewNote:row.review_note} : {}) };
}
