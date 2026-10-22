// Only for repeatable media GET/PUT operations, never generation submissions.
export async function retryTransfer(operation, { label, onRetry = async () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await operation(); }
    catch (e) {
      const transient = ['TimeoutError', 'AbortError', 'TypeError'].includes(e.name) || e.retryable === true;
      if (!transient || attempt === 3) {
        const failure = new Error(`${label} failed${transient ? ' after 3 transfer attempts' : ''}. The generated media is saved at its source; no regeneration is needed.`, {cause:e});
        failure.retryable = transient;
        throw failure;
      }
      await onRetry(attempt + 1);
      await sleep(attempt * 3000);
    }
  }
}
export function deferredTransfer(project, now = Date.now()) {
  const pending = project.clips?.find(c => !c.videoKey);
  const saved = pending?.recovery?.video?.attempts?.at(-1);
  if (!project.clips?.length || (pending && (!pending.requestId || saved?.requestId !== pending.requestId || saved.status !== 'complete' || !saved.result?.video?.url)))
    throw new Error('A completed result is required for automatic transfer recovery.');
  const itemId = pending?.id || 'assembly';
  const count = (project.transferRecoveries?.[itemId] || 0) + 1;
  if (count > 3) throw new Error('Automatic connection recovery reached its limit.');
  return { itemId, count, after: now + 60000 * 2 ** (count - 1) };
}
export function checkTransferResponse(response) {
  if (response.ok) return;
  const e = new Error(`Media transfer HTTP ${response.status}`);
  e.retryable = [408, 429].includes(response.status) || response.status >= 500;
  throw e;
}

// Ticket creation only allocates upload storage; it never generates media.
// Request a fresh ticket on retry so an expired URL cannot strand a saved image.
export async function publishReferenceImage(bytes, { createTicket, put, ...options }) {
  return retryTransfer(async () => {
    const ticket = await createTicket();
    if (!ticket?.upload_url || !ticket.public_url) throw new Error('Invalid reference upload ticket.');
    const response = await put(ticket, bytes);
    checkTransferResponse(response);
    return ticket.public_url;
  }, { label: 'Connecting your saved reference image to the video provider', ...options });
}

export function pendingReferenceTransfer(p) {
  if (p.workStage !== 'references' || !p.runtimeApprovedAt || p.referencesApprovedAt || p.generationAuthorization) return;
  const pending = p.assets?.find(a => !a.imageKey || !a.referenceUrl);
  // A stored image is positive evidence that generation completed. Never retry
  // an image submission with an unknown outcome under the guise of a transfer.
  if (!pending?.imageKey || pending.referenceUrl || !pending.imageKey.startsWith(`${p.id}/`)) return;
  if (p.assets.some(a => !a.imageKey && a.recovery?.reference?.attempts?.some(t => ['submitting','submitted'].includes(t.status)))) return;
  return pending;
}

export function deferredReferenceTransfer(p, now = Date.now()) {
  const pending = pendingReferenceTransfer(p);
  if (!pending) throw new Error('A saved reference image is required for transfer recovery.');
  const count = (p.referenceTransferRecoveries?.[pending.id] || 0) + 1;
  if (count > 3) throw new Error('Automatic reference connection recovery reached its limit.');
  return { itemId: pending.id, count, after: now + 60000 * 2 ** (count - 1) };
}

export function canResumeReferenceTransfer(p) {
  return p.status === 'failed' && (p.error === 'fetch failed' || p.failedOperation === 'reference-transfer') && !!pendingReferenceTransfer(p);
}
