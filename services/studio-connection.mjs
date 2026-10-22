// These operations have no provider-generation side effects. Snapshot retries
// send identical bytes and the server still checks the active lease and owner.
const REPEATABLE_ACTIONS = new Set(['checkpoint','heartbeat','mediaInfo']);
export async function studioRequest(body,{origin,headers,fetch:send=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onRetry=()=>{}}) {
  const repeatable=REPEATABLE_ACTIONS.has(body.action),payload=JSON.stringify(body),limit=repeatable?5:1;
  for(let attempt=1;attempt<=limit;attempt++) {
    try {
      const r=await send(`${origin}/api/worker`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(body.action==='checkpoint'?30000:repeatable?10000:60000)});
      const isJson=r.headers.get('content-type')?.includes('application/json');
      let data;
      try { if(isJson)data=await r.json(); }
      catch(cause) {const error=new Error('The studio response was interrupted.',{cause});error.retryable=r.ok || r.status>=500;error.status=r.status;throw error;}
      if(!r.ok || !isJson) {
        const error=new Error(data?.error || `Studio API returned ${r.status} without a usable response.`);
        error.status=r.status;error.retryable=[408,429,500,502,503,504].includes(r.status);throw error;
      }
      return data;
    } catch(error) {
      const retryable=error.retryable===true || ['TypeError','TimeoutError','AbortError'].includes(error.name);
      error.operation=body.action;
      if(!repeatable || !retryable || attempt===limit)throw error;
      onRetry({action:body.action,attempt:attempt+1});
      await sleep(1000*2**(attempt-1));
    }
  }
}
export function workerLeaseLost(error,lastHeartbeat,now=Date.now()) {
  return [401,403,409].includes(error.status) || now-lastHeartbeat>=110000;
}
export function savedStoryboardForRecovery(p) {
  if(p.status!=='failed' || p.workStage!=='storyboards' || !p.runtimeApprovedAt || !p.referencesApprovedAt || p.paidAt || p.checkoutId || p.generationAuthorization ||
     !(p.error==='The studio is temporarily unavailable. Your script is still here; please try again.' || p.failedOperation==='studio-checkpoint'))return;
  const clip=p.clips?.find(c=>c.storyboard?.some(s=>!s.referenceUrl)),shot=clip?.storyboard.find(s=>!s.referenceUrl);
  if(!shot?.imageKey?.startsWith(`${p.id}/storyboards/`) || shot.recovery?.storyboard?.attempts?.at(-1)?.status!=='complete')return;
  return {clipId:clip.id,shotIndex:clip.storyboard.indexOf(shot),imageKey:shot.imageKey};
}
// Log categories, not SQL strings, request payloads, image prompts or secrets.
export function studioErrorCategory(error) {
  const messages=[];let current=error;
  for(let i=0;i<4 && current;i++,current=current.cause)messages.push(String(current.message||''));
  const text=messages.join(' ');
  return ['SQLITE_TOOBIG','SQLITE_BUSY','SQLITE_FULL','SQLITE_CONSTRAINT','D1_ERROR','D1_EXEC_ERROR','D1_TYPE_ERROR','D1_COLUMN_NOTFOUND','R2_ERROR'].find(code=>text.includes(code)) || (/timeout|timed out/i.test(text)?'TIMEOUT':/storage is not connected/i.test(text)?'STORAGE_CONFIGURATION':'UNCLASSIFIED');
}
