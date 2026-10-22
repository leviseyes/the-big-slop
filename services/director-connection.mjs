// Never repeat a creation POST with an unknown outcome. Poll saved IDs instead.
export async function durableDirector(state, input, {call,checkpoint,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  if (state.submitting && !state.id) throw new Error("The planning submission lost its connection before a request ID was saved. It needs review before retrying to avoid duplicate charges.");
  let response;
  if(!state.id) {
    state.submitting=true; await checkpoint();
    try { response=await call('responses',{...input,background:true,store:true}); }
    catch(e) { throw new Error("The director connection failed while submitting the request. Its outcome is unknown; your uploaded references are saved. Review is required before retrying.",{cause:e}); }
    if(!/^resp_[a-zA-Z0-9_-]+$/.test(response.id || '')) throw new Error("The director did not return a valid request ID. Review is required before retrying.");
    state.id=response.id;state.submitting=false;await checkpoint();
  }
  for(let polls=0;polls<1440;polls++) {
    if(response && !['queued','in_progress'].includes(response.status)) return response;
    await sleep(5000);
    for(let retry=0;;retry++) {
      try { response=await call(`responses/${state.id}`); break; }
      catch(e) {
        if(retry>=11) throw new Error("The director connection is temporarily unavailable. Its request ID is saved; reconnect to continue without resubmitting.",{cause:e});
        await sleep(Math.min(30000,(retry+1)*3000));
      }
    }
  }
  throw new Error("The director is taking longer than expected. Its request ID is saved for reconnection.");
}
