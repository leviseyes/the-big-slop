// The server stores this receipt atomically with progress. The lease itself is
// never stored in production data or exposed to the browser.
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export async function checkpointReceipt(body,lease) {
  // Older renderers remain compatible until they are updated.
  if(body.saveSequence === undefined)return null;
  if(!Number.isSafeInteger(body.saveSequence) || body.saveSequence < 1)throw new Error('Invalid save sequence.');
  return {epoch:await digest(lease),sequence:body.saveSequence,digest:await digest(JSON.stringify({action:body.action,project:body.project}))};
}
export function checkpointDisposition(project,incoming) {
  const saved=project.workerSave;
  if(!incoming || !saved || saved.epoch!==incoming.epoch)return 'new';
  if(saved.sequence>incoming.sequence)return 'stale';
  if(saved.sequence===incoming.sequence)return saved.digest===incoming.digest?'saved':'mismatch';
  return 'new';
}
