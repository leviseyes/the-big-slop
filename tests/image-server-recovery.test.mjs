import test from 'node:test';
import assert from 'node:assert/strict';
import {providerFailure,RejectedGeneration,recoverGeneration,authorizeStoryboardServerRetry} from '../services/recovery.mjs';
const message='The server had an error while processing your request. Please include the request ID req_known in your message.';
const failure=()=>providerFailure('OpenAI',500,{error:{message}},{retryImageServerError:true,requestId:'req_header'});
test('documented OpenAI image processing error retries without a policy rewrite and keeps request diagnostics',async()=>{
 const state={};let calls=0,rewrites=0;
 const result=await recoverGeneration({state,prompt:'unchanged prompt',checkpoint:async()=>{},sleep:async()=>{},rewrite:async()=>{rewrites++;},execute:async()=>{if(++calls===1)throw failure();return 'saved.png';}});
 assert.equal(result,'saved.png');assert.equal(rewrites,0);assert.equal(state.prompt,'unchanged prompt');assert.equal(state.attempts[0].httpStatus,500);assert.equal(state.attempts[0].providerRequestId,'req_header');assert.equal(state.attempts[0].serverError,true);assert.equal(calls,2);
});
test('proxy, timeout, malformed and non-image errors are not classified as safe image retries',()=>{
 for(const [provider,status,data,opts] of [['OpenAI',502,{error:{message}},{retryImageServerError:true}],['OpenAI',504,{error:{message}},{retryImageServerError:true}],['OpenAI',500,{}, {retryImageServerError:true}],['OpenAI',500,{error:{message:'Gateway error'}},{retryImageServerError:true}],['OpenAI',500,{error:{message}},{}],['Higgsfield',500,{error:{message}},{retryImageServerError:true}]])assert.equal(providerFailure(provider,status,data,opts) instanceof RejectedGeneration,false);
});
test('repeated server errors stop after five attempts without rewriting',async()=>{
 const state={};let calls=0;
 await assert.rejects(recoverGeneration({state,prompt:'original',checkpoint:async()=>{},sleep:async()=>{},rewrite:async()=>assert.fail('must not rewrite'),execute:async()=>{calls++;throw failure();}}),/5 attempts/);assert.equal(calls,5);
});
const fixture=()=>({status:'failed',workStage:'storyboards',runtimeApprovedAt:1,referencesApprovedAt:2,error:`OpenAI (500): ${message}`,assets:[{imageKey:'saved.png'}],clips:[{id:'clip-19',storyboard:[{imageKey:'old.png',referenceUrl:'https://old'}, {recovery:{storyboard:{startedAt:1,prompt:'original',attempts:[{number:1,status:'submitting'}]}}}]}]});
test('legacy explicit 500 reconciles only the failed attempt and preserves completed work',()=>{
 const p=fixture();assert.deepEqual(authorizeStoryboardServerRetry(p,'req_known',100),{clipId:'clip-19',shotIndex:1});assert.equal(p.clips[0].storyboard[0].imageKey,'old.png');assert.equal(p.assets[0].imageKey,'saved.png');assert.equal(p.referencesApprovedAt,2);const state=p.clips[0].storyboard[1].recovery.storyboard;assert.equal(state.attempts.length,1);assert.equal(state.attempts[0].providerRequestId,'req_known');assert.equal(state.attempts[0].status,'rejected');assert.throws(()=>authorizeStoryboardServerRetry(p,'req_known'));
});
test('unknown outcomes, mismatched request and saved results cannot use the legacy repair',()=>{
 for(const change of [p=>p.error='fetch failed',p=>p.error='OpenAI (504): gateway timeout',p=>p.clips[0].storyboard[1].imageKey='already.png',p=>p.clips[0].storyboard[1].recovery.storyboard.rewriting=true,p=>p.generationAuthorization={},p=>p.error=p.error.replace('req_known','req_other')]){const p=fixture();change(p);const before=structuredClone(p);assert.throws(()=>authorizeStoryboardServerRetry(p,'req_known'));assert.deepEqual(p,before);}
});
