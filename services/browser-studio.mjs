/**
 * @param {string} action
 * @param {any} data
 * @param {{fetch?: typeof globalThis.fetch, sleep?: (ms:number)=>Promise<void>, signal?: AbortSignal}} options
 */
export async function browserStudioRequest(action,data={}, {fetch:send=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),signal}={}) {
  const readOnly=['get','list'].includes(action),payload=JSON.stringify({action,...data});
  for(let attempt=0;attempt<(readOnly?3:1);attempt++){
    if(signal?.aborted)throw signal.reason;
    try {
      const timeout=AbortSignal.timeout(30000);
      const response=await send('/api/studio',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,signal:signal?AbortSignal.any([signal,timeout]):timeout});
      let result;
      try {result=await response.json();}
      catch {const error=new Error('The studio connection was interrupted.');error.retryable=response.ok||response.status>=500;throw error;}
      if(!response.ok){const error=new Error((result.error||'The studio could not complete this request.')+(result.retryAt?` Next slot opens ${new Date(result.retryAt).toLocaleString()}.`:''));error.retryable=[408,429,500,502,503,504].includes(response.status);throw error;}
      return result;
    }catch(error){
      if(signal?.aborted)throw signal.reason;
      const network=['TypeError','TimeoutError','AbortError'].includes(error.name);
      if(readOnly && (network||error.retryable) && attempt<2){await sleep(1000*2**attempt);continue;}
      if(network || error.retryable){
        const failure=new Error(readOnly?'Connection interrupted. Saved work is unchanged; reconnecting to the studio.':'Connection interrupted before confirmation. Check your production before trying that action again.');
        failure.connection=true;throw failure;
      }
      throw error;
    }
  }
}
