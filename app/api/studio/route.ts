import { publicProduction } from "@/services/production-history.mjs";
import { boardsApproved, reviewStoryboard } from "@/services/storyboard-review.mjs";
import { imageCatalog } from "@/services/image-edit-context.mjs";
import { CATEGORIES, categoryOf } from "@/services/production-categories.mjs";
import { getSeries, seedSeries } from "@/lib/series";
import { z } from "zod";
import { DIALOGUE_LANGUAGES, productionSettings } from "@/services/production-direction.mjs";
import {
  targetClipCount,
  reviseReferences,
} from "@/services/production-workflow.mjs";
import {
  hasRenderAuthorization,
  paymentsEnabled,
} from "@/services/production-authorization.mjs";
import {
  AppError,
  config,
  db,
  failure,
  getProject,
  identity,
  json as rawJson,
  originCheck,
  ready,
  replace,
  stripe,
} from "@/lib/server";
function json(body:any,status=200) {
  return rawJson({...body,...(body.project?{project:publicProduction(body.project)}:{}),...(body.projects?{projects:body.projects.map(publicProduction)}:{})},status);
}
export const dynamic = "force-dynamic";
const draft = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
  format: z.string().refine(v=>[...CATEGORIES,"Movie","TV episode"].includes(v)),
  seriesId: z.string().uuid().nullable().optional(),
  style: z.enum(["Cinematic", "Animation", "Film noir", "Stage play"]),
  script: z.string().max(500000),
  dialogueLanguage: z.string().refine(v => DIALOGUE_LANGUAGES.includes(v)).default("English"),
  dialogueLanguages: z.array(z.string().refine(v => DIALOGUE_LANGUAGES.includes(v))).max(DIALOGUE_LANGUAGES.length).refine(v => new Set(v).size === v.length).optional(),
  textLanguages: z.array(z.string().refine(v => DIALOGUE_LANGUAGES.includes(v))).max(DIALOGUE_LANGUAGES.length).refine(v => new Set(v).size === v.length).default([]),
  languageNotes: z.string().trim().max(1000).default(""),
  resolution: z.enum(["480p", "720p"]).default("720p"),
  targetMinutes: z.number().min(0.5).max(360).multipleOf(0.5).default(5),
});
export async function POST(req: Request) {
  try {
    originCheck(req);
    if (Number(req.headers.get("content-length")) > 2100000)
      throw new AppError("Script is too large.");
    const input = (await req.json()) as any;
    const user = await identity();
    if (input.action === "list") {
      const r = await db()
        .prepare(
          "SELECT id,title,status,category,series_id FROM productions WHERE owner=? ORDER BY updated DESC LIMIT 100",
        )
        .bind(user)
        .all<{ id: string; title: string; status: string; category: string; series_id: string | null }>();
      return json({
        projects: r.results.map((r) => ({id:r.id,title:r.title,status:r.status,category:categoryOf(r),format:categoryOf(r),seriesId:r.series_id})),
        ready: await ready(),
      });
    }
    if (input.action === "writeIdea") {
      const idea = z.string().trim().min(10).max(10000).parse(input.idea);
      const id = z.string().uuid().parse(input.requestId);
      const existing = await db().prepare("SELECT owner FROM productions WHERE id=?").bind(id).first<any>();
      if (existing) return json({project:(await getProject(id,user)).project});
      const d = draft.parse({...input,script:"",id:undefined});
      if (!config.OPENAI_API_KEY) throw new AppError("Connect OpenAI in Studio setup to write a script.",503);
      if (d.seriesId) await getSeries(d.seriesId,user);
      const now=Date.now();
      const p={...d,...productionSettings(d),id,category:categoryOf(d),status:"writing",workflowVersion:4,workStage:"writing",assets:[],clips:[],script:"",ideaDraft:{idea,parts:[]},phase:"Your screenwriter is queued. You can leave this page and return to your saved draft."};
      const result=await db().batch([
        db().prepare("INSERT INTO productions(id,owner,title,status,data,category,series_id,created,updated) SELECT ?,?,?,'writing',?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM productions WHERE owner=? AND status='writing') AND (SELECT count(*) FROM productions WHERE owner=? AND created>? AND json_extract(data,'$.ideaDraft.idea') IS NOT NULL)<10")
          .bind(id,user,p.title,JSON.stringify(p),p.category,p.seriesId||null,now,now,user,user,now-86400000),
        db().prepare("INSERT INTO jobs(id,project_id,kind,created) SELECT ?,id,'script',? FROM productions WHERE id=? AND owner=?").bind(crypto.randomUUID(),now,id,user)
      ]);
      if(!result[0].meta.changes) throw new AppError("Finish your current script draft first, or try again after the daily script-writing allowance resets.",409);
      return json({project:p});
    }
    if (input.action === "save") {
      const parsed = draft.safeParse(input);
      if (!parsed.success)
        throw new AppError(
          "Check the title, script length, language selections, runtime and resolution. Native 1080p is not available yet.",
        );
      const d = { ...parsed.data, ...productionSettings(parsed.data), category:categoryOf(parsed.data) };
      if(d.seriesId) await getSeries(d.seriesId,user);
      if (d.id) {
        const row = await getProject(d.id, user);
        if (row.status !== "draft")
          throw new AppError(
            "This script is locked for production. Start a new production for revisions.",
          );
        const p = { ...row.project, ...d };
        await replace(row, p);
        return json({ project: p });
      }
      const id = crypto.randomUUID(),
        now = Date.now();
      const p = { ...d, id, status: "draft", phase: "", assets: [], clips: [] };
      await db()
        .prepare(
          "INSERT INTO productions(id,owner,title,status,data,category,series_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(id, user, d.title, "draft", JSON.stringify(p), d.category,d.seriesId || null, now, now)
        .run();
      return json({ project: p });
    }
    const row = await getProject(z.string().uuid().parse(input.id), user);
    const p = row.project;
    if (input.action === "get") {
      const job = await db()
        .prepare(
          "SELECT status,lease_until FROM jobs WHERE project_id=? AND status IN ('queued','running') ORDER BY created DESC LIMIT 1",
        )
        .bind(p.id)
        .first<any>();
      return json({
        project: p,
        ready: await ready(),
        updatedAt: row.updated,
        workerActive: job?.status === "running" && job.lease_until > Date.now(),
      });
    }
    if (input.action === "prepare") {
      if (p.status !== "draft")
        throw new AppError("This production has already started. Open it in My productions to follow its progress.", 409, {code: "production_started"});
      if (p.script.trim().split(/\s+/).length < 10)
        throw new AppError("Add at least 10 words before production.");
      if (!(await ready()).generation)
        throw new AppError(
          "Your draft is saved. Connect OpenAI, Higgsfield, and the render worker in Studio setup to start production.",
          503,
        );
      const now = Date.now();
      const limit = (value: unknown, fallback: number) => {
        const n = Number(value);
        return Number.isSafeInteger(n) && n > 0 ? n : fallback;
      };
      const perUserLimit = limit(config.DAILY_PREPARATIONS_PER_USER, 1);
      const globalLimit = limit(config.DAILY_PREPARATIONS_GLOBAL, 10);
      const next = {
        ...await seedSeries(p,user),
        status: "planning",
        workStage: "planning",
        workflowVersion: 3,
        targetMinutes: p.targetMinutes || 5,
        phase:
          "Your script is queued for a runtime and shot-plan review. No images are being generated yet.",
        preparationStartedAt: now,
      };
      const result = await db().batch([
        db()
          .prepare(
            "UPDATE productions SET data=?,status='planning',version=version+1,updated=? WHERE id=? AND version=? AND status='draft' AND (series_id IS NULL OR NOT EXISTS(SELECT 1 FROM productions other WHERE other.series_id=productions.series_id AND other.id<>productions.id AND other.status IN ('planning','planned','preparing'))) AND (SELECT COUNT(*) FROM productions WHERE owner=? AND json_extract(data,'$.preparationStartedAt')>?)<? AND (SELECT COUNT(*) FROM productions WHERE json_extract(data,'$.preparationStartedAt')>?)<?",
          )
          .bind(
            JSON.stringify(next),
            now,
            p.id,
            row.version,
            user,
            now - 86400000,
            perUserLimit,
            now - 86400000,
            globalLimit,
          ),
        db()
          .prepare(
            "INSERT OR IGNORE INTO jobs(id,project_id,kind,created) SELECT ?,id,'prepare',? FROM productions WHERE id=? AND status='planning' AND version=? AND data=?",
          )
          .bind(crypto.randomUUID(), now, p.id, row.version + 1, JSON.stringify(next)),
      ]);
      if (!result[0].meta.changes) {
        const current = await getProject(p.id, user);
        if (current.status !== "draft")
          throw new AppError("This production has already started. Open it in My productions to follow its progress.", 409, {code: "production_started"});
        if(current.project.seriesId) await seedSeries(current.project,user);
        const recent = await db().prepare(
          "SELECT owner,json_extract(data,'$.preparationStartedAt') AS started FROM productions WHERE json_extract(data,'$.preparationStartedAt')>? ORDER BY started ASC",
        ).bind(now - 86400000).all<{ owner: string; started: number }>();
        const own = recent.results.filter(r => r.owner === user);
        const userBlocked = own.length >= perUserLimit;
        const studioBlocked = recent.results.length >= globalLimit;
        if (userBlocked || studioBlocked) {
          const retryAt = Math.max(
            userBlocked ? Number(own[own.length - perUserLimit].started) + 86400000 : 0,
            studioBlocked ? Number(recent.results[recent.results.length - globalLimit].started) + 86400000 : 0,
          );
          throw new AppError(
            userBlocked
              ? `You’ve reached the limit of ${perUserLimit} preparation${perUserLimit === 1 ? "" : "s"} per rolling 24 hours. Your draft is saved; no new generation started.`
              : `The studio has reached its limit of ${globalLimit} preparations per rolling 24 hours. Your draft is saved; no new generation started.`,
            429, { code: userBlocked ? "preparation_user_limit" : "preparation_studio_limit", retryAt },
          );
        }
        throw new AppError("Your draft changed in another window. Refresh and try again.", 409, {code: "draft_changed"});
      }
      return json({ project: next });
    }
    if (["acceptStoryboard", "acceptAllStoryboards"].includes(input.action)) {
      let next; try { next=reviewStoryboard(p,input); } catch(e) { throw new AppError((e as Error).message,409); }
      await replace(row,next); return json({project:next});
    }
    if (["approveStoryboards", "reviseStoryboard", "approvePlan", "approveReferences", "replan", "reviseReference", "reviseReferences"].includes(input.action)) {
      if (p.paidAt || p.generationAuthorization || p.checkoutId)
        throw new AppError(
          "Production is committed. Its runtime and references can no longer be changed.",
          409,
        );
      if (!(await ready()).generation)
        throw new AppError(
          "The render worker is offline. Your changes have not started.",
          503,
        );
      let next: any;
      if (input.action === "reviseStoryboard") {
        try { next=reviewStoryboard(p,input); } catch(e) { throw new AppError((e as Error).message,409); }
      } else if (input.action === "approveStoryboards") {
        if (!['storyboards_ready','ready'].includes(p.status) || input.accepted !== true || !boardsApproved(p)) throw new AppError("Review and accept every current storyboard panel before continuing.",409);
        next={...p,storyboardsApprovedAt:Date.now(),status:'preparing',workStage:'frames',phase:'Storyboards approved. Preparing scene frames and your estimate.'};
      } else if (input.action === "approvePlan") {
        if (
          p.status !== "planned" ||
          input.planId !== p.planId ||
          input.accepted !== true
        )
          throw new AppError(
            "Review and approve the current runtime plan first.",
            409,
          );
        if (p.clips.length !== targetClipCount(p.targetMinutes))
          throw new AppError(
            "The shot count does not match your chosen runtime.",
            409,
          );
        next = {
          ...p,
          status: "preparing",
          workStage: "references",
          runtimeApprovedAt: Date.now(),
          phase: "Runtime approved. Your reference images are queued.",
          progress: undefined,
        };
      } else if (input.action === "approveReferences") {
        if(!["references_ready","storyboards_ready","ready"].includes(p.status) || !p.assets.every((a:any)=>a.imageKey)) throw new AppError("Wait until every reference image is ready.",409);
        const edits=z.array(z.object({assetId:z.string().min(1),description:z.string().trim().min(3).max(2000),changes:z.string().trim().max(2000).default(""),referenceIds:z.array(z.string().min(1)).max(15).default([])})).max(500).parse(input.edits || []);
        if(new Set(edits.map(e=>e.assetId)).size!==edits.length || edits.some(e=>!p.assets.some((a:any)=>a.id===e.assetId))) throw new AppError("Choose valid, unique reference images.");
        const regeneration=edits.filter(e=>e.changes).map(e=>({assetId:e.assetId,changes:e.changes,referenceIds:e.referenceIds}));
        if(regeneration.some(e=>e.changes.length<3)) throw new AppError("Describe each image change in at least three characters.");
        const reviewProject={...p,assets:p.assets.map((a:any)=>({...a,description:edits.find(e=>e.assetId===a.id)?.description ?? a.description}))};
        const catalog=imageCatalog(reviewProject);
        if(regeneration.some(e=>new Set(e.referenceIds).size!==e.referenceIds.length || e.referenceIds.some(id=>!catalog.some((r:any)=>r.id===id && r.id!==`asset:${e.assetId}`)))) throw new AppError("Choose valid supporting images for each edit.");
        next=regeneration.length?reviseReferences(reviewProject,regeneration):structuredClone(p);
        const changed=new Set(edits.filter(e=>e.description!==p.assets.find((a:any)=>a.id===e.assetId).description).map(e=>e.assetId));
        for(const e of edits) {const a=next.assets.find((a:any)=>a.id===e.assetId);a.description=e.description;a.reviewDescription=e.description;a.prompt=`${a.name}. ${e.description}`;}
        for(const c of next.clips) if(c.assetIds.some((id:string)=>changed.has(id))) {
          c.frameRevision=(c.frameRevision||0)+1;delete c.frameKey;delete c.frameUrl;delete c.plannedFrameUrl;delete c.input;if(c.recovery)delete c.recovery.frame;
          for(const shot of c.storyboard||[]) {delete shot.imageKey;delete shot.referenceUrl;delete shot.recovery;delete shot.approvedImageKey;}
        }
        next.status="preparing";next.referencesApprovedAt=Date.now();next.quote=undefined;next.workStage="references";next.progress=undefined;
        next.phase="Reference review complete. Applying your image changes, then building the storyboards.";
      } else if (input.action === "replan") {
        if (
          !["references_ready", "planned", "ready", "failed"].includes(p.status) ||
          p.clips.some((c: any) => c.requestId || c.videoKey)
        )
          throw new AppError(
            "Wait for preparation to finish before changing the runtime.",
            409,
          );
        const minutes = z
          .number()
          .min(0.5)
          .max(360)
          .multipleOf(0.5)
          .parse(input.targetMinutes);
        next = {
          ...p,
          targetMinutes: minutes,
          workflowVersion: 3,
          status: "planning",
          workStage: "planning",
          clips: [],
          planChunks: 0,
          directorRequests: undefined,
          planningTotal: undefined,
          planningUncertain: false,
          pendingPlan: undefined,
          planId: undefined,
          runtimeApprovedAt: undefined,
          referencesApprovedAt: undefined,
          quote: undefined,
          consent: undefined,
          error: undefined,
          progress: undefined,
          phase:
            "Replanning your script to the new runtime. Existing references will be reused where relevant.",
        };
      } else {
        if (p.status !== "ready")
          throw new AppError(
            "Reference editing opens when preparation finishes, before the final cost approval.",
            409,
          );
        const edits = z.array(z.object({assetId:z.string().min(1),changes:z.string().trim().min(3).max(2000),referenceIds:z.array(z.string().min(1)).max(15).default([])})).min(1).max(500).safeParse(
          input.action === "reviseReferences" ? input.edits : [{assetId:input.assetId,changes:input.changes,referenceIds:input.referenceIds}]
        );
        if(!edits.success || new Set(edits.data.map(e=>e.assetId)).size !== edits.data.length)
          throw new AppError("Select each reference once and describe its changes (3–2,000 characters).");
        if(edits.data.some(e=>!p.assets.some((a:any)=>a.id===e.assetId && a.imageKey)))
          throw new AppError("A selected reference is no longer available. Refresh and try again.",404);
        const catalog=imageCatalog(p);
        if(edits.data.some(e=>new Set(e.referenceIds).size!==e.referenceIds.length || e.referenceIds.some(id=>!catalog.some((r:any)=>r.id===id && r.id!==`asset:${e.assetId}`)))) throw new AppError("Choose valid supporting images for each edit.");
        next = reviseReferences(p, edits.data);
        next.workflowVersion = p.workflowVersion || 2;
        next.targetMinutes = p.clips.length / 2;
        next.runtimeApprovedAt = p.runtimeApprovedAt || Date.now();
      }
      next.operationToken = crypto.randomUUID();
      const result = await db().batch([
        db()
          .prepare(
            "UPDATE productions SET data=?,status=?,version=version+1,updated=? WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))",
          )
          .bind(
            JSON.stringify(next),
            next.status,
            Date.now(),
            p.id,
            row.version,
            p.id,
          ),
        db()
          .prepare(
            "INSERT INTO jobs(id,project_id,kind,status,created) SELECT ?,id,'prepare','queued',? FROM productions WHERE id=? AND version=? AND json_extract(data,'$.operationToken')=? ON CONFLICT(project_id,kind) DO UPDATE SET status='queued',lease=NULL,lease_until=0,created=excluded.created",
          )
          .bind(
            crypto.randomUUID(),
            Date.now(),
            p.id,
            row.version + 1,
            next.operationToken,
          ),
      ]);
      if (!result[0].meta.changes)
        throw new AppError(
          "This production changed or is still working. Refresh and try again.",
          409,
        );
      return json({ project: next });
    }
    if (["approveGeneration","checkout"].includes(input.action) && !p.generationAuthorization && !p.paidAt && p.clips.some((c:any)=>c.storyboard?.length) && (!p.storyboardsApprovedAt || !boardsApproved(p)))
      throw new AppError("Review and accept every storyboard panel before approving video generation.",409);
    if (input.action === "approveGeneration") {
      if (paymentsEnabled(config.PAYMENTS_ENABLED))
        throw new AppError("Payment is required for new productions.", 402);
      if (
        hasRenderAuthorization(p) &&
        ["queued", "rendering", "stitching", "complete"].includes(p.status)
      )
        return json({ project: p });
      if (p.status !== "ready" || !p.quote)
        throw new AppError(
          "Your reference images and quote need to be ready first.",
        );
      if (
        input.accepted !== true ||
        input.irreversibleAccepted !== true ||
        input.quoteId !== p.quote.id ||
        input.providerCents !== p.quote.providerCents
      )
        throw new AppError(
          "Please approve the current estimate and quality expectations first.",
          409,
        );
      if (
        !Number.isSafeInteger(p.quote.providerCents) ||
        p.quote.providerCents <= 0 ||
        !Number.isFinite(p.quote.expiresAt) ||
        p.quote.expiresAt <= Date.now()
      )
        throw new AppError(
          "This estimate expired or is invalid. Refresh the quote before continuing.",
        );
      if (!(await ready()).generation)
        throw new AppError(
          "The production worker is offline. Please try again when the studio is connected.",
          503,
        );
      if (p.checkoutId)
        throw new AppError(
          "This production has an existing payment session. Resolve it before starting with API credits.",
          409,
        );
      const now = Date.now();
      const next = {
        ...p,
        status: "queued",
        phase:
          "Cost approved. Your production is queued using the studio’s API accounts.",
        generationAuthorization: {
          kind: "owner-funded",
          approvedAt: now,
          quoteId: p.quote.id,
          providerCents: p.quote.providerCents,
        },
        consent: {
          version: "slop-v3",
          irreversibleAccepted: true,
          recoveryPolicy: "automatic-compliant-revisions-v1",
          acceptedAt: now,
          quoteId: p.quote.id,
          totalCents: p.quote.providerCents,
        },
      };
      const result = await db().batch([
        db()
          .prepare(
            "UPDATE productions SET data=?,status='queued',version=version+1,updated=? WHERE id=? AND version=? AND status='ready'",
          )
          .bind(JSON.stringify(next), now, p.id, row.version),
        db()
          .prepare(
            "INSERT OR IGNORE INTO jobs(id,project_id,kind,created) SELECT ?,id,'render',? FROM productions WHERE id=? AND status='queued' AND version=? AND json_extract(data,'$.generationAuthorization.approvedAt')=?",
          )
          .bind(crypto.randomUUID(), now, p.id, row.version + 1, now),
      ]);
      if (!result[0].meta.changes) {
        const latest = (await getProject(p.id, user)).project;
        if (hasRenderAuthorization(latest) && latest.quote.id === p.quote.id)
          return json({ project: latest });
        throw new AppError(
          "The estimate changed. Refresh and approve it again.",
          409,
        );
      }
      return json({ project: next });
    }
    if (input.action === "checkout") {
      if (!paymentsEnabled(config.PAYMENTS_ENABLED))
        throw new AppError(
          "Payments are disabled. Approve the estimate to start using the studio’s API accounts.",
          403,
        );
      if (p.status !== "ready" || !p.quote)
        throw new AppError(
          "Your reference images and quote need to be ready first.",
        );
      if (input.accepted !== true || input.irreversibleAccepted !== true)
        throw new AppError(
          "Please approve the cost and quality expectations first.",
        );
      if (p.quote.expiresAt < Date.now())
        throw new AppError(
          "This quote expired. Use Refresh quote before paying.",
        );
      if (!(await ready()).worker)
        throw new AppError(
          "The production worker is offline. Please try again when the studio is connected.",
          503,
        );
      if (p.checkoutId) {
        const existing = await stripe(
          `checkout/sessions/${encodeURIComponent(p.checkoutId)}`,
        );
        if (existing.status === "open") return json({ url: existing.url });
        if (existing.status === "complete")
          throw new AppError(
            "Payment submitted. Use Check payment to continue.",
          );
      }
      if (p.quote.expiresAt - Date.now() < 31 * 60 * 1000)
        throw new AppError("Please refresh this quote before opening payment.");
      const base = config.PUBLIC_APP_URL || new URL(req.url).origin;
      const body = new URLSearchParams({
        mode: "payment",
        "payment_method_types[0]": "card",
        success_url: `${base}/?project=${p.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/?project=${p.id}`,
        client_reference_id: p.id,
        "metadata[project_id]": p.id,
        "metadata[owner]": user,
        "metadata[quote_id]": p.quote.id,
        "payment_intent_data[metadata][project_id]": p.id,
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(p.quote.totalCents),
        "line_items[0][price_data][product_data][name]": `The Big Slop — ${p.title}`,
        "line_items[0][quantity]": "1",
        expires_at: String(Math.floor(p.quote.expiresAt / 1000)),
      });
      const session = await stripe(
        "checkout/sessions",
        body,
        `production-${p.id}-${p.quote.id}`,
      );
      const next = {
        ...p,
        checkoutId: session.id,
        consent: {
          version: "slop-v3",
          irreversibleAccepted: true,
          recoveryPolicy: "automatic-compliant-revisions-v1",
          acceptedAt: Date.now(),
          quoteId: p.quote.id,
          totalCents: p.quote.totalCents,
        },
      };
      await replace(row, next);
      return json({ url: session.url });
    }
    if (input.action === "refreshQuote") {
      if (p.status !== "ready")
        throw new AppError("Only unpaid ready productions can refresh quotes.");
      if (p.checkoutId) {
        const session = await stripe(
          `checkout/sessions/${encodeURIComponent(p.checkoutId)}`,
        );
        if (session.payment_status === "paid" || session.status === "complete")
          throw new AppError(
            "Payment received or processing. Verify payment to continue.",
          );
        if (session.status === "open")
          await stripe(
            `checkout/sessions/${encodeURIComponent(p.checkoutId)}/expire`,
            new URLSearchParams(),
          );
      }
      const refreshToken = crypto.randomUUID();
      const next = {
        ...p,
        refreshToken,
        status: "preparing",
        phase: "Refreshing your production quote.",
        quote: undefined,
        checkoutId: undefined,
        consent: undefined,
        generationAuthorization: undefined,
      };
      const refreshed = await db().batch([
        db()
          .prepare(
            "UPDATE productions SET data=?,status='preparing',version=version+1,updated=? WHERE id=? AND version=?",
          )
          .bind(JSON.stringify(next), Date.now(), p.id, row.version),
        db()
          .prepare(
            "UPDATE jobs SET status='queued',lease=NULL,lease_until=0 WHERE project_id=? AND kind='prepare' AND status='complete' AND EXISTS(SELECT 1 FROM productions WHERE id=? AND status='preparing' AND version=? AND json_extract(data,'$.refreshToken')=?)",
          )
          .bind(p.id, p.id, row.version + 1, refreshToken),
      ]);
      if (!refreshed[0].meta.changes)
        throw new AppError(
          "Quote changed. Refresh the page and try again.",
          409,
        );
      return json({ project: next });
    }
    if (input.action === "verifyPayment") {
      const sessionId = z
        .string()
        .regex(/^cs_[A-Za-z0-9_]+$/)
        .parse(input.sessionId || p.checkoutId);
      if (sessionId !== p.checkoutId)
        throw new AppError("Payment does not match this production.", 403);
      const session = await stripe(`checkout/sessions/${sessionId}`);
      await settlePayment(session);
      return json({ project: (await getProject(p.id, user)).project });
    }
    throw new AppError("Unknown studio action.");
  } catch (e) {
    if (e instanceof z.ZodError)
      return json({ error: "Invalid request." }, 400);
    return failure(e);
  }
}
export async function settlePayment(s: any) {
  if (s.payment_status !== "paid")
    throw new AppError(
      "Payment is still pending. Your production will start when Stripe confirms it.",
    );
  const row = await getProject(s.metadata?.project_id);
  const p = row.project;
  if (
    s.id !== p.checkoutId ||
    s.metadata?.owner !== row.owner ||
    s.metadata?.quote_id !== p.quote?.id ||
    s.amount_total !== p.quote?.totalCents ||
    s.currency !== "usd" ||
    p.consent?.quoteId !== p.quote?.id
  )
    throw new AppError("Payment verification mismatch.", 403);
  if (
    ["queued", "rendering", "stitching", "complete", "failed"].includes(
      p.status,
    )
  )
    return;
  if (p.status !== "ready") throw new AppError("Production is not ready.", 409);
  const next = {
    ...p,
    status: "queued",
    phase: "Funding confirmed. Your production is queued.",
    paidAt: Date.now(),
  };
  await db().batch([
    db()
      .prepare(
        "INSERT OR IGNORE INTO payments(session_id,project_id,owner,amount,created) VALUES(?,?,?,?,?)",
      )
      .bind(s.id, p.id, row.owner, s.amount_total, Date.now()),
    db()
      .prepare(
        "UPDATE productions SET data=?,status='queued',version=version+1,updated=? WHERE id=? AND status='ready'",
      )
      .bind(JSON.stringify(next), Date.now(), p.id),
    db()
      .prepare(
        "INSERT OR IGNORE INTO jobs(id,project_id,kind,created) VALUES(?,?,'render',?)",
      )
      .bind(crypto.randomUUID(), p.id, Date.now()),
  ]);
}
