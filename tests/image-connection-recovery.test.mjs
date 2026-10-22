import test from 'node:test';
import assert from 'node:assert/strict';
import {readImageResponse,IMAGE_CONNECTION_UNCERTAIN,authorizeStoryboardConnectionRetry,recoverGeneration} from '../services/recovery.mjs';

test('a terminated image response body preserves diagnostics and never auto-resubmits',async()=>{
 const state={};let calls=0;
 await assert.rejects(recoverGeneration({state,prompt:'original',checkpoint:async()=>{},execute:async attempt=>{
  calls++;
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"data":'));c.error(new TypeError('terminated'));}});
  return readImageResponse(new Response(body,{headers:{'x-request-id':'req_body_interrupted'}}),attempt);
 }}),e=>e.message===IMAGE_CONNECTION_UNCERTAIN);
 assert.equal(calls,1);assert.equal(state.attempts[0].status,'submitting');assert.equal(state.attempts[0].providerRequestId,'req_body_interrupted');assert.equal(state.attempts[0].outcomeUncertain,true);
 await assert.rejects(recoverGeneration({state,prompt:'original',checkpoint:async()=>{},execute:async()=>{calls++;}}),/uncertain outcome/);
 assert.equal(calls,1);
});
test('intact success and provider rejection bodies remain available for classification',async()=>{
 for(const status of [200,400,500]){
  const attempt={},data=status===200?{data:[{b64_json:'image'}]}:{error:{message:'provider error'}};
  assert.deepEqual(await readImageResponse(Response.json(data,{status,headers:{'x-request-id':'req_test'}}),attempt),data);
  assert.equal(attempt.httpStatus,status);assert.equal(attempt.outcomeUncertain,undefined);
 }
});
const fixture=()=>({id:'p',status:'failed',workStage:'storyboards',runtimeApprovedAt:1,referencesApprovedAt:2,error:'terminated',assets:[{id:'a',imageKey:'saved-reference'}],clips:[{id:'clip-212',frameRevision:2,storyboard:[{imageKey:'saved-board',referenceUrl:'https://saved'}, {revision:1,recovery:{storyboard:{startedAt:1,prompt:'original',attempts:[{number:1,status:'submitting',providerRequestId:'req_uncertain'}]}}}]}]});
test('explicit retry preserves completed work and the uncertain attempt, then continues once',async()=>{
 const p=fixture(),saved=structuredClone(p.clips[0].storyboard[0]);
 assert.deepEqual(authorizeStoryboardConnectionRetry(p,'clip-212',1,true,100),{clipId:'clip-212',shotIndex:1,imageKey:'p/storyboards/clip-212-v2-1-r1.png'});
 const state=p.clips[0].storyboard[1].recovery.storyboard;
 assert.equal(state.attempts[0].outcomeUncertain,true);assert.equal(state.attempts[0].operatorRetryApprovedAt,100);assert.equal(state.attempts[0].providerRequestId,'req_uncertain');
 let calls=0;await recoverGeneration({state,prompt:'unused',checkpoint:async()=>{},sleep:async()=>{},now:()=>101,execute:async()=>{calls++;return 'new.png';},rewrite:async()=>assert.fail('do not rewrite an interrupted prompt')});
 assert.equal(calls,1);assert.equal(state.attempts.length,2);assert.equal(state.attempts[1].status,'complete');assert.deepEqual(p.clips[0].storyboard[0],saved);assert.equal(p.assets[0].imageKey,'saved-reference');assert.equal(p.referencesApprovedAt,2);
 assert.throws(()=>authorizeStoryboardConnectionRetry(p,'clip-212',1,true));
});
test('consent is limited to the exact unknown shot and cannot bypass rejection or attempt caps',()=>{
 for(const change of [p=>p.error='Content rejected',p=>p.status='preparing',p=>p.paidAt=1,p=>p.generationAuthorization={},p=>p.referencesApprovedAt=undefined,p=>p.clips[0].storyboard[1].imageKey='already.png',p=>p.clips[0].storyboard[1].recovery.storyboard.rewriting=true,p=>p.clips[0].storyboard[1].recovery.storyboard.attempts[0].requestId='known',p=>p.clips[0].storyboard[1].recovery.storyboard.attempts=Array.from({length:5},()=>({status:'submitting'}))]){
  const p=fixture();change(p);const before=structuredClone(p);assert.throws(()=>authorizeStoryboardConnectionRetry(p,'clip-212',1,true));assert.deepEqual(p,before);
 }
 for(const [clip,shot,consent] of [['clip-212',1,false],['clip-211',1,true],['clip-212',0,true]])assert.throws(()=>authorizeStoryboardConnectionRetry(fixture(),clip,shot,consent));
});
