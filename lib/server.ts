import { studioErrorCategory } from "@/services/studio-connection.mjs";
import { categoryOf } from "@/services/production-categories.mjs";
import { env } from "cloudflare:workers";
import { getStudioUser } from "@/app/auth";
import { paymentsEnabled } from "@/services/production-authorization.mjs";
export const config = env as unknown as Record<string, any>;
export const db = () => {
  if (!config.DB) throw new Error("Studio storage is not connected yet.");
  return config.DB as D1Database;
};
export const bucket = () => {
  if (!config.BUCKET) throw new Error("Media storage is not connected yet.");
  return config.BUCKET as R2Bucket;
};
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: { code?: string; retryAt?: number },
  ) {
    super(message);
  }
}
export async function identity() {
  const u = await getStudioUser();
  if (!u) throw new AppError("Sign in to save and produce your script.", 401);
  return u.userId;
}
export function originCheck(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    throw new AppError("Cross-origin request rejected.", 403);
}
export async function getProject(id: string, owner?: string) {
  const row = await db()
    .prepare(
      `SELECT * FROM productions WHERE id=?${owner ? " AND owner=?" : ""}`,
    )
    .bind(...(owner ? [id, owner] : [id]))
    .first<any>();
  if (!row) throw new AppError("Production not found.", 404);
  const project = JSON.parse(row.data);
  return { ...row, project: {...project, title:row.title, category:categoryOf({...project,category:row.category}), format:categoryOf({...project,category:row.category}), seriesId:row.series_id || null} };
}
export async function replace(row: any, project: any) {
  const result = await db()
    .prepare(
      "UPDATE productions SET data=?,title=?,status=?,category=?,series_id=?,version=version+1,updated=? WHERE id=? AND version=?",
    )
    .bind(
      JSON.stringify(project),
      project.title,
      project.status,
      categoryOf(project),
      project.seriesId || null,
      Date.now(),
      row.id,
      row.version,
    )
    .run();
  if (!result.meta.changes)
    throw new AppError("This production changed. Refresh and try again.", 409);
}
export async function ready() {
  const heartbeat = await db()
    .prepare("SELECT value FROM runtime WHERE key='worker_heartbeat'")
    .first<{ value: string }>();
  const worker = !!heartbeat && Date.now() - Number(heartbeat.value) < 90000;
  const openai = !!config.OPENAI_API_KEY;
  const higgsfield = !!config.HF_KEY;
  const stripe = !!config.STRIPE_SECRET_KEY;
  return {
    openai,
    higgsfield,
    stripe,
    paymentsEnabled: paymentsEnabled(config.PAYMENTS_ENABLED),
    worker,
    workerLastSeenAt: heartbeat ? Number(heartbeat.value) : null,
    generation: openai && higgsfield && worker,
  };
}
export function json(body: any, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function failure(e: unknown, operation = "request") {
  if (e instanceof AppError) return json({ error: e.message, ...e.details }, e.status);
  const incidentId = crypto.randomUUID();
  console.error("Studio request failed", {incidentId,operation,category:studioErrorCategory(e)});
  return json(
    {
      error:
        "The studio is temporarily unavailable. Your script is still here; please try again.",
      code: "STUDIO_UNAVAILABLE", incidentId,
    },
    503,
  );
}
export async function stripe(
  path: string,
  body?: URLSearchParams,
  key?: string,
) {
  if (!config.STRIPE_SECRET_KEY)
    throw new AppError(
      "Payments are not connected yet. Your quote is saved.",
      503,
    );
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body,
  });
  const data = (await r.json()) as any;
  if (!r.ok)
    throw new AppError("Payment provider unavailable. Please try again.", 502);
  return data;
}
export async function workerAuth(req: Request) {
  const supplied = req.headers.get("authorization");
  if (
    !config.WORKER_SECRET ||
    !supplied ||
    supplied !== `Bearer ${config.WORKER_SECRET}`
  )
    throw new AppError("Unauthorized worker.", 401);
}
