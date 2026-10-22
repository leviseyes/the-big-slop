export const MAX_GENERATION_ATTEMPTS = 5;
export const RECOVERY_DEADLINE_MS = 6 * 60 * 60 * 1000;
export const IMAGE_CONNECTION_UNCERTAIN = "The image provider connection was interrupted before a result arrived. Completed images are saved. Confirm a retry to continue; the interrupted request may already have been charged.";

// fetch() can succeed while reading its response body later fails (for example,
// Undici's "terminated"). This is still an unknown generation outcome.
export async function readImageResponse(response, attempt) {
  if (attempt) {
    attempt.httpStatus = response.status;
    const requestId = response.headers.get('x-request-id');
    if (/^req_[a-zA-Z0-9_-]+$/.test(requestId || '')) attempt.providerRequestId = requestId;
  }
  try { return await response.json(); }
  catch (cause) {
    if (attempt) attempt.outcomeUncertain = true;
    throw new Error(IMAGE_CONNECTION_UNCERTAIN, {cause});
  }
}

export function authorizeStoryboardConnectionRetry(p, clipId, shotIndex, accepted, now = Date.now()) {
  const clip = p.clips?.find(c => c.storyboard?.some(s => !s.referenceUrl));
  const shot = clip?.storyboard.find(s => !s.referenceUrl), state = shot?.recovery?.storyboard;
  const last = state?.attempts?.at(-1);
  if (accepted !== true || p.status !== 'failed' || p.workStage !== 'storyboards' ||
      !['terminated','fetch failed',IMAGE_CONNECTION_UNCERTAIN].includes(p.error) ||
      !p.runtimeApprovedAt || !p.referencesApprovedAt || p.generationAuthorization || p.paidAt || p.checkoutId ||
      !clip || clip.id !== clipId || clip.storyboard.indexOf(shot) !== shotIndex || shot.imageKey || shot.referenceUrl ||
      state?.rewriting || state?.revisionError || last?.status !== 'submitting' || last.requestId ||
      state.attempts.length >= MAX_GENERATION_ATTEMPTS)
    throw new Error('This storyboard is not eligible for an authorized connection retry.');
  // Keep the uncertain attempt in its history and attempt limit. Consent applies
  // only to this specific pending shot, never other interruptions or rejections.
  last.status = 'rejected'; last.transient = true; last.repaired = true;
  last.outcomeUncertain = true; last.operatorRetryApprovedAt = now;
  last.error = 'Connection outcome unknown; additional-charge risk explicitly accepted.';
  state.previousStartedAt = state.startedAt; state.startedAt = now;
  p.status = 'preparing'; delete p.error; delete p.failedOperation; delete p.progress;
  p.phase = 'Retrying the interrupted storyboard image with your approval. Completed images are preserved.';
  return {clipId,shotIndex,imageKey:`${p.id}/storyboards/${clip.id}-v${clip.frameRevision || 0}-${shotIndex}-r${shot.revision || 0}.png`};
}

export function authorizeStoryboardServerRetry(p, providerRequestId, now = Date.now()) {
  const clip = p.clips?.find(c => c.storyboard?.some(s => !s.referenceUrl));
  const shot = clip?.storyboard.find(s => !s.referenceUrl), state = shot?.recovery?.storyboard;
  const last = state?.attempts?.at(-1);
  if (p.status !== "failed" || p.workStage !== "storyboards" || !p.runtimeApprovedAt || !p.referencesApprovedAt ||
      p.generationAuthorization || p.paidAt || p.checkoutId || shot?.imageKey || shot?.referenceUrl ||
      !/^req_[a-zA-Z0-9]+$/.test(providerRequestId || "") ||
      !/^OpenAI \(500\): The server had an error while processing your request\./.test(p.error || "") ||
      !p.error.includes(`request ID ${providerRequestId}`) || state?.rewriting || state?.revisionError ||
      last?.status !== "submitting" || last.requestId || state.attempts.length >= MAX_GENERATION_ATTEMPTS)
    throw new Error("This storyboard has no confirmed OpenAI processing error eligible for retry.");
  // Reconcile only the explicit HTTP error logged by the old image worker.
  // req_* is a diagnostic identifier, not a pollable Responses request ID.
  last.status = "rejected"; last.transient = true; last.repaired = true;
  last.serverError = true; last.httpStatus = 500; last.providerRequestId = providerRequestId;
  last.error = p.error; last.reconciledAt = now;
  state.previousStartedAt = state.startedAt; state.startedAt = now;
  p.status = "preparing"; delete p.error; delete p.progress;
  p.phase = "Retrying the storyboard after an OpenAI processing error. Completed images are preserved.";
  return {clipId:clip.id,shotIndex:clip.storyboard.indexOf(shot)};
}

export function authorizeReferenceRetry(p, assetId, accepted, now = Date.now()) {
  const asset = p.assets?.find(a => !a.imageKey || !a.referenceUrl);
  const state = asset?.recovery?.reference;
  const last = state?.attempts?.at(-1);
  if (accepted !== true || p.status !== "failed" || !["fetch failed", IMAGE_CONNECTION_UNCERTAIN].includes(p.error) ||
      p.workStage !== "references" || !p.runtimeApprovedAt || p.referencesApprovedAt || p.generationAuthorization ||
      !asset || asset.id !== assetId || asset.imageKey || asset.referenceUrl || state.rewriting || state.revisionError ||
      last?.status !== "submitting" || last.requestId || state.attempts.length >= MAX_GENERATION_ATTEMPTS)
    throw new Error("This image is not eligible for an authorized connection retry.");
  // Retain the uncertain attempt and count it toward the cap. Only explicit
  // acceptance allows another submission; no safety rejection is overridden.
  last.status = "rejected";
  last.transient = true;
  last.repaired = true;
  last.outcomeUncertain = true;
  last.operatorRetryApprovedAt = now;
  last.error = "Connection outcome unknown; additional-charge risk explicitly accepted.";
  state.previousStartedAt = state.startedAt;
  state.startedAt = now;
  return asset.id;
}

export class RejectedGeneration extends Error {
  constructor(message, { policy = false, transient = false } = {}) {
    super(message);
    this.policy = policy;
    this.transient = transient;
  }
}

export function providerFailure(provider, status, data, { retryImageServerError = false, requestId } = {}) {
  const detail =
    data?.error?.message ||
    data?.detail ||
    data?.message ||
    "Provider rejected the request.";
  const message = `${provider} (${status}): ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 600)}`;
  const code = data?.error?.code || data?.code;
  const policy =
    [
      "content_policy_violation",
      "moderation_blocked",
      "safety_violation",
    ].includes(code) ||
    /content policy|safety system|moderation|nsfw/i.test(message);
  // OpenAI documents retrying its explicit JSON 500 processing-error response.
  // Opt in only at image-generation endpoints. Empty/proxy 5xx, network loss,
  // and Responses submissions remain uncertain and are not resubmitted here.
  if (retryImageServerError && provider === "OpenAI" && status === 500 &&
      data?.error && typeof data.error.message === "string" &&
      /The server had an error while processing your request/i.test(data.error.message)) {
    const error = new RejectedGeneration(message, { transient: true });
    error.serverError = true;
    error.httpStatus = status;
    error.providerRequestId = requestId || data.error.message.match(/\breq_[a-zA-Z0-9]+\b/)?.[0];
    return error;
  }
  // Other 5xx and timeouts can hide an accepted POST.
  if ([429, 423].includes(status))
    return new RejectedGeneration(message, { transient: true });
  if (status === 400 && (policy || provider === "Higgsfield"))
    return new RejectedGeneration(message, { policy });
  return new Error(message);
}

export function videoTerminalFailure(data) {
  if (["failed", "nsfw"].includes(data.status))
    return new RejectedGeneration(
      `Video ${data.status}: ${String(data.error || "Generation rejected").slice(0, 600)}`,
      { policy: data.status === "nsfw" },
    );
  return new Error(
    `Video ${data.status}. Production stopped; canceled or unknown requests are not resubmitted.`,
  );
}

// Durable attempt state is checkpointed before every paid operation. Known request
// IDs may resume polling; an unacknowledged submission is never repeated.
export async function recoverGeneration({
  state,
  prompt,
  checkpoint,
  rewrite,
  execute,
  beforeSubmit = async () => {},
  onEvent = () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
}) {
  state.startedAt ??= now();
  state.prompt ??= prompt;
  state.attempts ??= [];
  while (true) {
    let last = state.attempts.at(-1);
    if (last?.status === "complete") return last.result;
    // Retrieving an already-submitted request is read-only and must remain
    // possible after downtime. The deadline still blocks all new paid retries.
    const pendingRequest = last?.requestId && ["submitted", "submitting"].includes(last.status);
    if (now() - state.startedAt > RECOVERY_DEADLINE_MS && !pendingRequest)
      throw new Error(
        "Automatic recovery reached its six-hour limit. Completed work is saved.",
      );
    if (state.revisionError)
      throw new Error(`Director revision needs review (${state.revisionError}). Completed work is saved.`);
    if (state.rewriting)
      throw new Error(
        "A director rewrite has an uncertain outcome. Review is required before spending again.",
      );
    if (last?.status === "submitting" && !last.requestId)
      throw new Error(
        "Generation submission has an uncertain outcome. It will not be charged twice automatically.",
      );
    if (last?.status === "rejected") {
      if (state.attempts.length >= MAX_GENERATION_ATTEMPTS)
        throw new Error(
          `Automatic recovery stopped after ${MAX_GENERATION_ATTEMPTS} attempts for this item. Completed work is saved.`,
        );
      if (!last.repaired) {
        if (!last.transient) {
          state.rewriting = true;
          onEvent(
            `Director is revising the rejected prompt (attempt ${state.attempts.length + 1}/${MAX_GENERATION_ATTEMPTS}).`,
          );
          await checkpoint();
          const revised = await rewrite({
            prompt: state.prompt,
            feedback: last.error,
            policy: last.policy,
            attempt: state.attempts.length + 1,
          });
          // The director returned a definite response: preserve it before validation.
          // A rejected rewrite is not an uncertain submission and must not be lost.
          state.rewriting = false;
          state.lastRevision = revised;
          state.revisionError = !revised?.canProceed ? "no_safe_adaptation"
            : typeof revised.prompt !== "string" || !revised.prompt.trim() ? "empty_prompt"
            : revised.prompt.length > 6000 ? "prompt_too_long" : undefined;
          await checkpoint();
          if (state.revisionError) {
            const reason = state.revisionError === "no_safe_adaptation"
              ? "The director could not create a suitable replacement that meets the provider’s safety rules."
              : state.revisionError === "prompt_too_long"
                ? "The director’s replacement prompt exceeded the 6,000-character limit."
                : "The director returned an empty replacement prompt.";
            throw new Error(`${reason} Completed work is saved.`);
          }
          state.prompt = revised.prompt;
          state.replacementFramePrompt = revised.replacementFramePrompt || "";
          state.summary = String(revised.summary || "Prompt revised.").slice(
            0,
            500,
          );
          state.textOnly ||= last.policy;
          state.rewriting = false;
          onEvent(state.summary);
        }
        last.repaired = true;
        await checkpoint();
      }
      await sleep(Math.min(60000, 2000 * 2 ** (state.attempts.length - 1)));
      last = null;
    }
    if (!last) {
      if (state.attempts.length >= MAX_GENERATION_ATTEMPTS)
        throw new Error("Automatic recovery attempt limit reached.");
      // Reference review is not a generation submission. A local review failure
      // must not leave behind a phantom paid attempt with an unknown outcome.
      await beforeSubmit(state);
      last = {
        number: state.attempts.length + 1,
        status: "submitting",
        startedAt: now(),
      };
      state.attempts.push(last);
      await checkpoint();
    }
    try {
      const result = await execute(last, state);
      last.status = "complete";
      last.result = result;
      await checkpoint();
      return result;
    } catch (e) {
      if (!(e instanceof RejectedGeneration)) throw e;
      last.status = "rejected";
      last.error = e.message;
      last.policy = e.policy;
      last.transient = e.transient;
      if (e.serverError) {
        last.serverError = true;
        last.httpStatus = e.httpStatus;
        last.providerRequestId = e.providerRequestId;
      }
      onEvent(
        e.serverError ? "The image provider reported a temporary processing error. Waiting briefly before retrying this image; completed images are saved."
          : `${e.policy ? "Content rejected" : "Generation rejected"}. Preparing automatic recovery.`,
      );
      await checkpoint();
    }
  }
}
