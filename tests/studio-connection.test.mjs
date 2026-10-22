import test from 'node:test';
import assert from 'node:assert/strict';
import {studioRequest,workerLeaseLost,savedStoryboardForRecovery,studioErrorCategory} from '../services/studio-connection.mjs';
const base={origin:'https://studio.example',headers:{},sleep:async()=>{}};
const response=(status,data)=>Response.json(data,{status});
test('503 checkpoint retries the exact snapshot and succeeds without any generation call',async()=>{
 const body={action:'checkpoint',project:{assets:['saved'],attempt:{status:'complete'}}},sent=[];
 const result=await studioRequest(body,{...base,fetch:async(_url,options)=>{sent.push(options.body);if(sent.length===1){body.project.assets.push('later mutation');return response(503,{error:'temporary'});}return response(200,{ok:true});}});
 assert.equal(result.ok,true);assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);
});
test('lost checkpoint response after server commit safely resends identical state',async()=>{
 let saved,calls=0;
 await studioRequest({action:'checkpoint',project:{imageKey:'saved.png'}},{...base,fetch:async(_url,options)=>{calls++;if(calls===1){saved=options.body;throw new TypeError('connection lost');}assert.equal(options.body,saved);return response(200,{ok:true});}});assert.equal(calls,2);
});
test('claim, finish and multipart creation are not blindly replayed',async()=>{
 for(const action of ['claim','finish','multipartStart']){let calls=0;await assert.rejects(studioRequest({action},{...base,fetch:async()=>{calls++;return response(503,{error:'temporary'});}}));assert.equal(calls,1);}
});
test('authorization, stale leases and validation errors stop immediately',async()=>{
 for(const status of [400,401,403,409]){let calls=0;await assert.rejects(studioRequest({action:'checkpoint'},{...base,fetch:async()=>{calls++;return response(status,{error:'stop'});}}),e=>e.status===status);assert.equal(calls,1);}
});
test('transient failure stops after five checkpoint attempts',async()=>{
 let calls=0;await assert.rejects(studioRequest({action:'checkpoint'},{...base,fetch:async()=>{calls++;return response(503,{error:'temporary'});}}),e=>e.operation==='checkpoint');assert.equal(calls,5);
});
test('heartbeat outage does not instantly discard an otherwise valid lease',()=>{
 assert.equal(workerLeaseLost({status:503},1000,30000),false);assert.equal(workerLeaseLost({status:409},1000,30000),true);assert.equal(workerLeaseLost({status:503},1000,111000),true);
});
const fixture=()=>({id:'p',status:'failed',workStage:'storyboards',runtimeApprovedAt:1,referencesApprovedAt:2,error:'The studio is temporarily unavailable. Your script is still here; please try again.',clips:[{id:'c',storyboard:[{imageKey:'p/storyboards/c.png',recovery:{storyboard:{attempts:[{status:'complete'}]}}}]}]});
test('resume is limited to already stored completed storyboard results',()=>{
 assert.deepEqual(savedStoryboardForRecovery(fixture()),{clipId:'c',shotIndex:0,imageKey:'p/storyboards/c.png'});
 const conflict=fixture();conflict.error='Checkpoint conflict.';conflict.failedOperation='studio-checkpoint';
 assert.equal(savedStoryboardForRecovery(conflict).imageKey,'p/storyboards/c.png');
 for(const change of [p=>p.clips[0].storyboard[0].recovery.storyboard.attempts[0].status='submitting',p=>delete p.clips[0].storyboard[0].imageKey,p=>p.clips[0].storyboard[0].imageKey='another/storyboards/c.png',p=>p.generationAuthorization={},p=>p.error='content rejected']){const p=fixture();change(p);assert.equal(savedStoryboardForRecovery(p),undefined);}
});
test('diagnostics expose category without SQL data or secrets',()=>{
 assert.equal(studioErrorCategory(new Error('failed',{cause:new Error('D1_ERROR SQLITE_BUSY private script and credentials')})),'SQLITE_BUSY');assert.equal(studioErrorCategory(new Error('private secret data')),'UNCLASSIFIED');
});
