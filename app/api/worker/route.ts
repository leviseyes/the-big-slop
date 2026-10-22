import { checkpointReceipt, checkpointDisposition } from "@/services/checkpoint-order.mjs";
import { savedStoryboardForRecovery } from "@/services/studio-connection.mjs";
import { authorizeReferenceReviewResume } from "@/services/reference-preflight.mjs";
import { authorizeSafeWardrobeRecovery, pendingImageDiagnostics, adoptAcceptedWardrobe } from "@/services/safe-adaptation.mjs";
import { referenceStatements } from "@/lib/series";
import {
  AppError,
  config,
  bucket,
  db,
  failure,
  getProject,
  json,
  workerAuth,
} from "@/lib/server";
import {
  hasRenderAuthorization,
  paymentsEnabled,
} from "@/services/production-authorization.mjs";
import { targetClipCount } from "@/services/production-workflow.mjs";
import { videoStatusEndpoint, resumePricingQuote } from "@/services/production-core.mjs";
import { productionSettings, canResumeContinuityPlanning } from "@/services/production-direction.mjs";
import { deferredTransfer, deferredReferenceTransfer, pendingReferenceTransfer, canResumeReferenceTransfer } from "@/services/media-transfer.mjs";
import { authorizeReferenceRetry, authorizeStoryboardServerRetry, authorizeStoryboardConnectionRetry } from "@/services/recovery.mjs";
export const dynamic = "force-dynamic";
async function lease(id: string, token: string) {
  const job = await db()
    .prepare(
      "SELECT * FROM jobs WHERE id=? AND lease=? AND status='running' AND lease_until>?",
    )
    .bind(id, token, Date.now())
    .first<any>();
  if (!job) throw new AppError("Worker lease expired.", 409);
  return job;
}
export async function POST(req: Request) {
  let operation = "worker-request";
  try {
    await workerAuth(req);
    const body = (await req.json()) as any;
    if(typeof body.action === "string" && /^[A-Za-z]{1,40}$/.test(body.action)) operation=body.action;
    const now = Date.now();
    if (body.action === "repairLegacyEnding") {
      const row=await getProject(body.projectId), p=row.project;
      const c=p.clips.at(-1), state=c?.recovery?.video;
      if(p.status!=="complete" || !hasRenderAuthorization(p) || p.endingRepairAt || !c?.videoKey || !c.safetyReplacement || !state?.textOnly || state.attempts?.at(-1)?.status!=="complete" || state.attempts.length>=5)
        throw new AppError("This production is not eligible for the legacy ending repair.",409);
      p.endingRepairAt=now;
      p.previousOutputKey=p.outputKey;
      c.previousVersion={videoKey:c.videoKey,frameKey:c.frameKey,frameUrl:c.frameUrl,recovery:structuredClone(c.recovery),requestId:c.requestId};
      delete c.videoKey;delete c.continuityChecks;
      c.replacements={}; c.repairRevision=now;
      // Keep request IDs and attempt count; this completed result failed user continuity review.
      const last=state.attempts.at(-1);
      last.status="rejected";last.error="User continuity review rejected the replacement: wrong cast and setting. Preserve the established safe character and location references while adapting the originally rejected content.";last.policy=true;last.transient=false;delete last.repaired;
      state.startedAt=now;state.rewriting=false;delete state.revisionError;delete state.replacementFramePrompt;
      state.prompt=JSON.stringify({originalScene:c.prompt,opening:c.openingState,closing:c.closingState,shots:c.storyboard,dialogue:c.dialogue,actionBeats:c.actionBeats,productionBible:p.productionBible});
      c.status="planned";p.status="queued";delete p.error;p.phase="Repairing the final clip with the original cast and setting. All other completed clips are preserved.";
      const data=JSON.stringify(p);
      const result=await db().batch([
        db().prepare("UPDATE productions SET data=?,status='queued',version=version+1,updated=? WHERE id=? AND version=? AND status='complete' AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))").bind(data,now,p.id,row.version,p.id),
        db().prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=0 WHERE project_id=? AND kind='render' AND status='complete' AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)").bind(p.id,p.id,row.version+1,data)
      ]);
      if(!result[0].meta.changes || !result[1].meta.changes) throw new AppError("Production changed; repair was not queued.",409);
      return json({ok:true,status:'queued',preservedClips:p.clips.filter((c:any)=>c.videoKey).length});
    }
    // Authenticated operator diagnostics and narrowly scoped repair. Neither
    // action changes the script, consent, quote, or any saved provider request.
    if (["resumePricingQuote", "retryStoryboardConnection", "resumeSavedStoryboard", "retryStoryboardServerError", "resumeReferenceReview", "finalizeSafeWardrobe", "resumeSafeWardrobe", "inspectProduction", "resumeStatusPolling", "resumeMediaTransfer", "resumeAssetPlanning", "resumeContinuityPlanning", "resumeReferenceTransfer", "retryReferenceGeneration", "retryPlanningConnection", "resumeLegacyDirectorRevision"].includes(body.action)) {
      if (typeof body.projectId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.projectId))
        throw new AppError("Invalid production ID.");
      const row = await getProject(body.projectId);
      const p = row.project;
      if (body.action === "inspectProduction")
        return json({
          id: p.id, status: p.status, error: p.error, phase: p.phase, failedOperation: p.failedOperation,
          quote:p.quote, resolution:p.resolution, savedFrames:p.clips.filter((c:any)=>c.frameKey && c.frameUrl).length,
          totalClips: p.clips.length, planningUncertain:p.planningUncertain, workStage:p.workStage,
          recoveryDiagnostics: p.clips.filter((c:any)=>!c.videoKey).map((c:any)=>({
            clipId:c.id, prompt:c.prompt, dialogue:c.dialogue, actionBeats:c.actionBeats,
            recovery:c.recovery,
          })),
          pendingStoryboard:pendingImageDiagnostics(p),
          wardrobeCandidates:p.assets.filter((a:any)=>a.kind==="character").map((a:any)=>({id:a.id,name:a.name,description:a.description,stored:!!a.imageKey})),
          savedStoryboards:p.clips.reduce((n:number,c:any)=>n+(c.storyboard||[]).filter((s:any)=>s.imageKey).length,0),
          savedReferences:p.assets.filter((a:any)=>a.imageKey).length,
          connectedReferences:p.assets.filter((a:any)=>a.referenceUrl).length,
          pendingReference: p.assets.filter((a:any)=>!a.imageKey || !a.referenceUrl).slice(0,1).map((a:any)=>({id:a.id,stored:!!a.imageKey,connected:!!a.referenceUrl,attemptStatus:a.recovery?.reference?.attempts?.at(-1)?.status})),
          uploadedReferences:p.assets.filter((a:any)=>a.source==="upload" && a.imageKey).length,
          directorRequests:p.directorRequests,

          planChunks: p.planChunks, planningTotal: p.planningTotal, pendingPlanSection: p.pendingPlan?.section,
          continuityGuideLength: p.productionBible?.length, pendingContinuityGuideLength: p.pendingPlan?.plan?.productionBible?.length,
          completedClips: p.clips.filter((c: any) => c.videoKey).length,
          requests: p.clips.filter((c: any) => c.requestId).map((c: any) => ({
            clipId: c.id, requestId: c.requestId, statusUrl: c.statusUrl,
            status: c.status, stored: !!c.videoKey,
            attemptStatus: c.recovery?.video?.attempts?.at(-1)?.status,
          })),
        });
      if(body.action === "resumePricingQuote") {
        let next; try { next=resumePricingQuote(p); } catch(e:any) { throw new AppError(e.message,409); }
        const data=JSON.stringify(next);
        const results=await db().batch([
          db().prepare("UPDATE productions SET data=?,status='preparing',version=version+1,updated=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND kind='prepare' AND status='failed') AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))").bind(data,now,p.id,row.version,p.id,p.id),
          db().prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=0 WHERE project_id=? AND kind='prepare' AND status='failed' AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)").bind(p.id,p.id,row.version+1,data)
        ]);
        if(!results[0].meta.changes || !results[1].meta.changes) throw new AppError("Production changed; quote recovery was not queued.",409);
        return json({ok:true,status:next.status,workStage:next.workStage});
      }
      if(body.action === "finalizeSafeWardrobe") {
        const asset=p.assets.find((a:any)=>a.id===body.assetId);
        if(p.status!=="references_ready" || !p.safeWardrobeRecoveryAt || p.referencesApprovedAt || p.generationAuthorization || p.requestedSafetyDirection || !asset || !adoptAcceptedWardrobe(p,asset)) throw new AppError("Accepted wardrobe cannot be finalized in this state.",409);
        const result=await db().prepare("UPDATE productions SET data=?,version=version+1,updated=? WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))").bind(JSON.stringify(p),now,p.id,row.version,p.id).run();
        if(!result.meta.changes) throw new AppError("Production changed; reload before updating its wardrobe.",409);
        return json({ok:true,status:p.status,wardrobe:asset.name,note:p.safetyWardrobeNote});
      }
      if(["retryStoryboardConnection","resumeSavedStoryboard","retryStoryboardServerError","resumeSafeWardrobe","resumeReferenceReview"].includes(body.action)) {
        try { if(body.action==="resumeSavedStoryboard") {
          const pending=savedStoryboardForRecovery(p);
          if(!pending || !await bucket().head(pending.imageKey)) throw new Error("A saved storyboard image is required to resume without regeneration.");
          p.status="preparing";delete p.error;delete p.failedOperation;delete p.progress;
          p.phase="Resuming from the saved storyboard image. Completed images will not be regenerated.";
        } else if(body.action==="retryStoryboardConnection") {
          const pending=authorizeStoryboardConnectionRetry(p,body.clipId,body.shotIndex,body.acceptPossibleDuplicateCharge,now);
          if(await bucket().head(pending.imageKey) || await bucket().head(pending.imageKey.replace(/\.png$/,"-wide.png")))
            throw new Error("A stored image already exists for this shot. Reconnect it instead of regenerating.");
        } else if(body.action==="retryStoryboardServerError") authorizeStoryboardServerRetry(p,body.providerRequestId,now); else if(body.action==="resumeReferenceReview") authorizeReferenceReviewResume(p,now); else authorizeSafeWardrobeRecovery(p,body.assetId,now); }
        catch(e:any) { throw new AppError(e.message,409); }
        const data=JSON.stringify(p);
        const results=await db().batch([
          db().prepare("UPDATE productions SET data=?,status='preparing',version=version+1,updated=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND kind='prepare' AND status='failed') AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))").bind(data,now,p.id,row.version,p.id,p.id),
          db().prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=0 WHERE project_id=? AND kind='prepare' AND status='failed' AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)").bind(p.id,p.id,row.version+1,data)
        ]);
        if(!results[0].meta.changes || !results[1].meta.changes) throw new AppError("Production changed; recovery was not queued.",409);
        return json({ok:true,status:p.status,assetId:body.assetId,reviewRequired:body.action==="resumeSafeWardrobe"});
      }
      if(body.action === "retryPlanningConnection") {
        if(body.acceptPossibleDuplicateCharge !== true || p.status!=="failed" || p.error!=="fetch failed" || p.workStage!=="planning" || !p.planningUncertain || p.pendingPlan || p.runtimeApprovedAt || p.clips.length || p.generationAuthorization)
          throw new AppError("This planning request is not eligible for an authorized connection retry.",409);
        const next={...p,status:"planning",error:undefined,planningUncertain:false,phase:"Reconnecting to the director. Your uploaded reference images are preserved.",connectionRetryApprovedAt:now};
        const data=JSON.stringify(next);
        const results=await db().batch([
          db().prepare("UPDATE productions SET data=?,status='planning',version=version+1,updated=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND kind='prepare' AND status='failed') AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))").bind(data,now,p.id,row.version,p.id,p.id),
          db().prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=0 WHERE project_id=? AND kind='prepare' AND status='failed' AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)").bind(p.id,p.id,row.version+1,data)
        ]);
        if(!results[0].meta.changes || !results[1].meta.changes) throw new AppError("Production changed; retry was not queued.",409);
        return json({ok:true,status:"planning",savedReferences:p.assets.filter((a:any)=>a.imageKey).length});
      }
      if (["resumeReferenceTransfer", "retryReferenceGeneration"].includes(body.action)) {
        const generationRetry = body.action === "retryReferenceGeneration";
        let referenceId;
        if (generationRetry) {
          try { referenceId = authorizeReferenceRetry(p,body.assetId,body.acceptPossibleDuplicateCharge,now); }
          catch (e:any) { throw new AppError(e.message,409); }
        } else {
          if (!canResumeReferenceTransfer(p)) throw new AppError("This reference has no confirmed saved image to reconnect safely.",409);
          const pending = pendingReferenceTransfer(p);
          if (!await bucket().head(pending.imageKey)) throw new AppError("The saved reference image could not be verified.",409);
          referenceId = pending.id;
        }
        const next = {...p,status:"preparing",error:undefined,failedOperation:undefined,
          phase:generationRetry ? "Retrying the interrupted image with your approval. Completed images and planning are preserved." : "Reconnecting the saved reference image. Completed images and planning are preserved."};
        const data = JSON.stringify(next);
        const results = await db().batch([
          db().prepare("UPDATE productions SET data=?,status='preparing',version=version+1,updated=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND kind='prepare' AND status='failed') AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))").bind(data,now,p.id,row.version,p.id,p.id),
          db().prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=0 WHERE project_id=? AND kind='prepare' AND status='failed' AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)").bind(p.id,p.id,row.version+1,data),
        ]);
        if (!results[0].meta.changes || !results[1].meta.changes) throw new AppError("Production changed; recovery was not queued.",409);
        return json({ok:true,status:"preparing",referenceId});
      }
      if (["resumeAssetPlanning", "resumeContinuityPlanning"].includes(body.action)) {
        const continuityRecovery = body.action === "resumeContinuityPlanning";
        if (continuityRecovery ? !canResumeContinuityPlanning(p) : (p.status !== "failed" || p.error !== "Conflicting asset identity in production plan." ||
            p.workStage !== "planning" || p.runtimeApprovedAt || p.paidAt || p.generationAuthorization ||
            p.clips.some((c: any) => c.requestId || c.videoKey || c.frameKey) || p.assets.some((a: any) => a.imageKey)))
          throw new AppError("This production is not eligible for the requested planning recovery.",409);
        const next = {...p,status:"planning",error:undefined,planningUncertain:false,
          phase:continuityRecovery ? "Resuming the saved script section with the established film continuity guide." : "Resuming the unfinished script section and matching recurring references. Completed planning is saved.",assetPlanningRepairAt:now};
        const data = JSON.stringify(next);
        const results = await db().batch([
          db().prepare("UPDATE productions SET data=?,status='planning',version=version+1,updated=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND kind='prepare' AND status='failed') AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))")
            .bind(data,now,p.id,row.version,p.id,p.id),
          db().prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=0 WHERE project_id=? AND kind='prepare' AND status='failed' AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)")
            .bind(p.id,p.id,row.version+1,data),
        ]);
        if (!results[0].meta.changes || !results[1].meta.changes) throw new AppError("Production changed or its planning job is not paused.",409);
        return json({ok:true,status:"planning",completedSections:p.planChunks || 0});
      }
      const pending = p.clips.find((c: any) => c.requestId && !c.videoKey);
      const attempt = pending?.recovery?.video?.attempts?.at(-1);
      const directorRepair = body.action === "resumeLegacyDirectorRevision" &&
        p.error === "The director could not create a suitable replacement. Completed work is saved." &&
        attempt?.status === "rejected" && pending?.recovery?.video?.rewriting === true &&
        !pending.recovery.video.lastRevision && !p.directorRepairAt &&
        now - pending.recovery.video.startedAt < 6 * 60 * 60 * 1000;
      const pollingRepair = body.action === "resumeStatusPolling" && p.error === "Invalid provider status endpoint." && attempt?.status === "submitted";
      const transferRepair = body.action === "resumeMediaTransfer" &&
        (p.failedOperation === "media-transfer" || p.error === "The operation was aborted due to timeout") &&
        attempt?.status === "complete" && !!attempt?.result?.video?.url;
      if (p.status !== "failed" || (!pollingRepair && !transferRepair && !directorRepair) ||
          !hasRenderAuthorization(p) || !pending || !attempt ||
          attempt.requestId !== pending.requestId ||
          p.clips.some((c: any) => c.status === "submitting" && !c.requestId))
        throw new AppError("This production is not eligible for the requested recovery.", 409);
      videoStatusEndpoint(pending.requestId);
      if (directorRepair) {
        // The legacy error occurs only after the director returned a completed response.
        // Keep all provider attempts and limits; request one new safe adaptation.
        pending.recovery.video.rewriting = false;
        p.directorRepairAt = now;
      }
      const next = { ...p, status: "queued", error: undefined,
        phase: directorRepair ? "The director is creating a simpler safe ending. Completed clips are preserved." : transferRepair ? "Resuming storage of the completed video. It will not be regenerated." : "Reconnecting to the saved video request. Existing generations will not be resubmitted.",
        pollingRepairAt: now };
      const data = JSON.stringify(next);
      const results = await db().batch([
        db().prepare("UPDATE productions SET data=?,status='queued',version=version+1,updated=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND kind='render' AND status='failed') AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND status IN ('queued','running'))")
          .bind(data, now, p.id, row.version, p.id, p.id),
        db().prepare("UPDATE jobs SET status='queued',lease=NULL,lease_until=0 WHERE project_id=? AND kind='render' AND status='failed' AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)")
          .bind(p.id, p.id, row.version + 1, data),
      ]);
      if (!results[0].meta.changes || !results[1].meta.changes)
        throw new AppError("Production changed or its render job is not paused.", 409);
      return json({ ok: true, status: "queued", resumedRequestId: pending.requestId });
    }
    if (body.action === "claim") {
      await db()
        .prepare(
          "INSERT INTO runtime(key,value) VALUES('worker_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind(String(now))
        .run();
      const token = crypto.randomUUID();
      const job = await db()
        .prepare(
          "UPDATE jobs SET status='running',lease=?,lease_until=? WHERE id=(SELECT j.id FROM jobs j JOIN productions p ON p.id=j.project_id WHERE ((j.status='queued' AND j.lease_until<=?) OR (j.status='running' AND j.lease_until<?)) AND COALESCE(json_extract(p.data,'$.workflowVersion'),1)<=? ORDER BY j.created LIMIT 1) RETURNING *",
        )
        .bind(token, now + 120000, now, now, [2,3,4].includes(body.workflowVersion) ? body.workflowVersion : 1)
        .first<any>();
      if (!job) return json({ job: null });
      const row = await getProject(job.project_id);
      return json({
        job,
        project: row.project,
        policy: {
          markupPercent: paymentsEnabled(config.PAYMENTS_ENABLED)
            ? Number(config.PRODUCTION_MARKUP_PERCENT ?? 20)
            : 0,
        },
      });
    }
    const job = await lease(body.jobId, body.lease);
    if (body.action === "mediaInfo") {
      if (!validKey(body.key, job.project_id)) throw new AppError("Invalid media key.");
      const object = await bucket().head(body.key);
      return json({exists: !!object, size: object?.size ?? null});
    }
    if (body.action === "heartbeat") {
      await db().batch([
        db()
          .prepare("UPDATE jobs SET lease_until=? WHERE id=? AND lease=?")
          .bind(now + 120000, job.id, body.lease),
        db()
          .prepare(
            "INSERT INTO runtime(key,value) VALUES('worker_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .bind(String(now)),
      ]);
      return json({ ok: true });
    }
    if (["checkpoint", "finish", "deferTransfer", "deferReferenceTransfer"].includes(body.action)) {
      if (body.saveSequence !== undefined && (!Number.isSafeInteger(body.saveSequence) || body.saveSequence < 1))
        throw new AppError("Invalid save sequence.");
      const receipt = await checkpointReceipt(body, job.lease);
      // A timed-out request can still commit. Re-read and reconcile its receipt
      // before retrying an optimistic save; never replay over newer progress.
      for (let collision = 0; collision < 4; collision++) {
        await lease(body.jobId, body.lease);
        const row = await getProject(job.project_id);
        const disposition = checkpointDisposition(row.project, receipt);
        if (disposition === "saved") return json({ok:true,alreadySaved:true});
        if (disposition !== "new") throw new AppError("A newer production save already exists; reconnecting to saved progress.",409);
        const p = structuredClone(body.project);
        if (
          !p ||
          p.id !== row.id ||
          (job.kind !== "script" && p.script !== row.project.script)
        )
          throw new AppError("Invalid production checkpoint.");
        p.title = row.project.title;
        if (job.kind === "render" && !hasRenderAuthorization(row.project))
          throw new AppError("Production cost approval required.", 402);
        // Authorization is owned by the studio API, never by a worker snapshot.
        for (const field of [
          "paidAt",
          "checkoutId",
          "consent",
          "generationAuthorization",
        ])
          p[field] = row.project[field];
        if (job.kind === "render") p.quote = row.project.quote;
        const allowed =
          job.kind === "script" ? ["writing"] : job.kind === "prepare"
            ? ["planning", "preparing"]
            : ["queued", "rendering", "stitching"];
        if (!allowed.includes(row.status))
          throw new AppError("Production no longer belongs to this job.", 409);
        const referenceDeferred = body.action === "deferReferenceTransfer";
        const deferred = body.action === "deferTransfer" || referenceDeferred;
        if (referenceDeferred) {
          if (job.kind !== "prepare" || row.project.failedOperation !== "reference-transfer") throw new AppError("Only saved reference transfers can be deferred.",409);
          let retry;
          try { retry = deferredReferenceTransfer(row.project, now); }
          catch { throw new AppError("Automatic reference recovery is unavailable for this state.",409); }
          Object.assign(p,row.project,{
            status:"preparing",error:undefined,failedOperation:undefined,transferRetry:retry,
            referenceTransferRecoveries:{...row.project.referenceTransferRecoveries,[retry.itemId]:retry.count},
            phase:"Reconnecting to the video provider shortly. Your reference image is saved; it will not be regenerated.",
          });
        } else if (deferred) {
          if (job.kind !== "render") throw new AppError("Only completed video transfers can be deferred.", 409);
          let retry;
          try { retry = deferredTransfer(row.project, now); }
          catch { throw new AppError("Automatic transfer recovery is unavailable for this state.", 409); }
          Object.assign(p, row.project, {
            status: "queued", error: undefined, failedOperation: undefined,
            transferRetry: retry,
            transferRecoveries: {...row.project.transferRecoveries, [retry.itemId]: retry.count},
            phase: "Connection interrupted while saving your video. Automatic recovery is scheduled; completed clips are preserved.",
          });
        } else {
          p.referenceTransferRecoveries = row.project.referenceTransferRecoveries;
          p.transferRecoveries = row.project.transferRecoveries;
          if (p.status !== "queued") p.transferRetry = undefined;
        }
        const terminal = body.action === "finish" || deferred;
        if (
          terminal
            ? !["storyboards_ready", "references_ready", "planned", "ready", "complete", "failed", ...(deferred ? [referenceDeferred ? "preparing" : "queued"] : []), ...(job.kind === "script" ? ["draft"] : [])].includes(p.status)
            : !["planning", "preparing", "rendering", "stitching", ...(job.kind === "script" ? ["writing"] : [])].includes(
                p.status,
              )
        )
          throw new AppError("Invalid job transition.");
        if (
          job.kind === "prepare" &&
          !["planning", "preparing", "storyboards_ready", "references_ready", "planned", "ready", "failed"].includes(
            p.status,
          )
        )
          throw new AppError("Invalid preparation state.");
        if (job.kind === "script" && (!["writing","draft","failed"].includes(p.status) || typeof p.script !== "string" || p.script.length > 500000 || (p.status === "draft" && !p.script.trim()))) throw new AppError("Invalid generated script.");
        if (job.kind === "script") { p.assets=row.project.assets; p.clips=row.project.clips; }
        if (job.kind === "render" && ["references_ready", "planned", "ready"].includes(p.status))
          throw new AppError("Render cannot reset approval.");
        if (
          job.kind === "prepare" &&
          row.project.workflowVersion >= 2 &&
          !row.project.runtimeApprovedAt &&
          !["planning", "planned", "failed"].includes(p.status)
        )
          throw new AppError(
            "Runtime approval required before image generation.",
            409,
          );
        p.category = row.project.category;
        p.seriesId = row.project.seriesId;
        p.format = row.project.format;
        p.runtimeApprovedAt = row.project.runtimeApprovedAt;
        p.referencesApprovedAt = row.project.referencesApprovedAt;
        p.workflowVersion = row.project.workflowVersion;
        p.targetMinutes = row.project.targetMinutes;
        p.dialogueLanguage = row.project.dialogueLanguage || "English";
        Object.assign(p, productionSettings(row.project));
        if (job.kind === "prepare" && p.workflowVersion >= 2 && ["planned", "ready"].includes(p.status) && p.clips.length !== targetClipCount(p.targetMinutes))
          throw new AppError("The proposed runtime does not match the selected runtime.",409);
        p.workerSave = receipt || row.project.workerSave;
        const data = JSON.stringify(p);
        const saveNow = Date.now();
        const update = db()
          .prepare(
            "UPDATE productions SET data=?,status=?,version=version+1,updated=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND lease=? AND status='running' AND lease_until>?)",
          )
          .bind(data, p.status, saveNow, p.id, row.version, job.id, body.lease, saveNow);
        const newAssets=p.assets.filter((a:any)=>a.imageKey && !row.project.assets.some((old:any)=>old.id===a.id && old.imageKey===a.imageKey));
        const finalReferences = job.kind === "prepare" && p.status === "ready";
        const references = finalReferences || newAssets.length || p.productionBible !== row.project.productionBible ? referenceStatements({...p,assets:finalReferences ? p.assets : newAssets},row.owner,false,{version:row.version+1,data}) : [];
        if (terminal) {
          const results = await db().batch([
            update,
            db()
              .prepare(
                "UPDATE jobs SET status=?,lease=NULL,lease_until=? WHERE id=? AND lease=? AND EXISTS(SELECT 1 FROM productions WHERE id=? AND version=? AND data=?)",
              )
              .bind(
                deferred ? "queued" : p.status === "failed" ? "failed" : "complete",
                deferred ? p.transferRetry.after : 0,
                job.id,
                body.lease,
                p.id,
                row.version + 1,
                data,
              ),
            ...references,
          ]);
          if (!results[0].meta.changes || !results[1].meta.changes) {
            if (receipt && !results[0].meta.changes && collision < 3) continue;
            throw new AppError("Completion conflict.", 409);
          }
        } else {
          const results = await db().batch([update,...references]);
          if (!results[0].meta.changes) {
            if (receipt && collision < 3) continue;
            throw new AppError("Checkpoint conflict.", 409);
          }
        }
        return json({ ok: true });
      }
    }
    if (body.action === "multipartStart") {
      if (!validKey(body.key, job.project_id))
        throw new AppError("Invalid media key.");
      const m = await bucket().createMultipartUpload(body.key, {
        httpMetadata: { contentType: "video/mp4" },
      });
      return json({ uploadId: m.uploadId, key: m.key });
    }
    if (body.action === "multipartComplete") {
      if (!validKey(body.key, job.project_id))
        throw new AppError("Invalid media key.");
      const m = bucket().resumeMultipartUpload(body.key, body.uploadId);
      await m.complete(body.parts);
      return json({ ok: true });
    }
    if (body.action === "multipartAbort") {
      if (!validKey(body.key, job.project_id))
        throw new AppError("Invalid media key.");
      await bucket().resumeMultipartUpload(body.key, body.uploadId).abort();
      return json({ ok: true });
    }
    throw new AppError("Unknown worker operation.");
  } catch (e) {
    return failure(e,operation);
  }
}
function validKey(key: unknown, id: string) {
  return (
    typeof key === "string" &&
    key.startsWith(`${id}/`) &&
    /^[a-zA-Z0-9_./-]+$/.test(key) &&
    !key.includes("..")
  );
}
export async function PUT(req: Request) {
  try {
    await workerAuth(req);
    const u = new URL(req.url);
    const job = await lease(
      u.searchParams.get("jobId") || "",
      u.searchParams.get("lease") || "",
    );
    const key = u.searchParams.get("key") || "";
    if (!validKey(key, job.project_id) || !req.body)
      throw new AppError("Invalid media upload.");
    const size = Number(req.headers.get("content-length"));
    if (!size || size > 32 * 1024 * 1024)
      throw new AppError("Upload parts must be under 32 MB.");
    const uploadId = u.searchParams.get("uploadId");
    if (uploadId) {
      const n = Number(u.searchParams.get("part"));
      if (!Number.isInteger(n) || n < 1 || n > 10000)
        throw new AppError("Invalid part number.");
      const part = await bucket()
        .resumeMultipartUpload(key, uploadId)
        .uploadPart(n, req.body);
      return json(part);
    }
    await bucket().put(key, req.body, {
      httpMetadata: {
        contentType:
          req.headers.get("content-type") || "application/octet-stream",
      },
    });
    return json({ key });
  } catch (e) {
    return failure(e);
  }
}
export async function GET(req: Request) {
  try {
    await workerAuth(req);
    const u = new URL(req.url);
    const job = await lease(
      u.searchParams.get("jobId") || "",
      u.searchParams.get("lease") || "",
    );
    const key = u.searchParams.get("key") || "";
    if (!validKey(key, job.project_id)) {
      const current = await getProject(job.project_id);
      if (!current.project.assets.some((a:any)=>a.imageKey===key || a.editSourceKey===key)) throw new AppError("Invalid media key.");
      await getProject(key.split("/")[0],current.owner);
    }
    const object = await bucket().get(key);
    if (!object) throw new AppError("Media not found.", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type":
          object.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(object.size),
      },
    });
  } catch (e) {
    return failure(e);
  }
}
