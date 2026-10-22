import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReferencePreflight, ReferenceReviewRejected, authorizeReferenceReviewResume, MAX_REFERENCE_REPAIRS } from '../services/reference-preflight.mjs';
const revised={canProceed:true,prompt:'Alex alone by the same car. Unidentified crowd remains off-screen.',summary:'Kept background shoppers off-screen; preserved Alex and the location.'};
const args=state=>({state,stage:'safe-image-references-storyboard-1',checkpoint:async()=>{},rewrite:async()=>revised});
test('failed reference review is revised and reviewed again without new image attempts',async()=>{
 const state={prompt:'Same two shoppers accompany Alex',attempts:[{status:'rejected',policy:true,repaired:true}]},stages=[];
 await resolveReferencePreflight({...args(state),review:async(stage,prompt)=>{stages.push(stage);if(stages.length===1)throw new ReferenceReviewRejected(stage,'No established pair');assert.equal(prompt,revised.prompt);}});
 assert.equal(state.attempts.length,1);assert.equal(state.referencePreflight.revisions.length,1);assert.equal(stages[1],'safe-image-references-storyboard-1-revision-1');
});
test('persistent unsafe or unresolved references stop at the repair cap, including after resume',async()=>{
 const state={prompt:'original',attempts:[]};let rewrites=0;
 const options={...args(state),rewrite:async()=>{rewrites++;return revised;},review:async stage=>{throw new ReferenceReviewRejected(stage,'Unsafe reference');}};
 await assert.rejects(resolveReferencePreflight(options),/after 2 revisions/);
 await assert.rejects(resolveReferencePreflight(options),/after 2 revisions/);
 assert.equal(rewrites,MAX_REFERENCE_REPAIRS);assert.equal(state.attempts.length,0);
});
test('network or unknown review failures do not trigger blind rewrites',async()=>{
 const state={prompt:'original',attempts:[]};let rewrites=0;
 await assert.rejects(resolveReferencePreflight({...args(state),rewrite:async()=>{rewrites++;return revised;},review:async()=>{throw Error('unknown request');}}),/unknown request/);assert.equal(rewrites,0);
});
test('rewrite request state survives a connection interruption for durable polling',async()=>{
 const state={prompt:'original',attempts:[]};let calls=0;
 const options={...args(state),review:async(stage)=>{if(!stage.includes('revision'))throw new ReferenceReviewRejected(stage,'Ambiguous extras');},rewrite:async(_args,request)=>{calls++;if(!request.id){request.id='resp_saved';throw Error('poll unavailable');}assert.equal(request.id,'resp_saved');return revised;}};
 await assert.rejects(resolveReferencePreflight(options),/poll unavailable/);await resolveReferencePreflight(options);assert.equal(calls,2);assert.equal(state.referencePreflight.revisions[0].request.id,'resp_saved');
});
test('invalid director revision is saved and not repeated',async()=>{
 const state={prompt:'original',attempts:[]};let calls=0;
 const options={...args(state),review:async stage=>{throw new ReferenceReviewRejected(stage,'Missing identity');},rewrite:async()=>{calls++;return {canProceed:false};}};
 await assert.rejects(resolveReferencePreflight(options),/could not resolve/);await assert.rejects(resolveReferencePreflight(options),/could not resolve/);assert.equal(calls,1);
});
const fixture=()=>{const stage='safe-image-references-storyboard-1',reason='Crowd does not identify the pair';return {status:'failed',workStage:'storyboards',referencesApprovedAt:10,error:new ReferenceReviewRejected(stage,reason).message,assets:[{imageKey:'saved'}],clips:[{id:'clip-19',storyboard:[{composition:'saved',continuityChecks:{[stage]:{started:true,passed:false,reason}},recovery:{storyboard:{textOnly:true,startedAt:1,attempts:[{status:'rejected',policy:true,repaired:true}]}}}]}]};};
test('operator resume preserves saved review verdict, provider attempts, images and approvals',()=>{
 const p=fixture(),before=structuredClone(p);assert.equal(authorizeReferenceReviewResume(p,50),'clip-19');assert.equal(p.status,'preparing');assert.equal(p.referencesApprovedAt,10);assert.deepEqual(p.assets,before.assets);assert.deepEqual(p.clips[0].storyboard[0].continuityChecks,before.clips[0].storyboard[0].continuityChecks);assert.deepEqual(p.clips[0].storyboard[0].recovery.storyboard.attempts,before.clips[0].storyboard[0].recovery.storyboard.attempts);
});
test('unknown submission, incomplete review, other error and committed state cannot resume',()=>{
 for(const change of [p=>p.clips[0].storyboard[0].recovery.storyboard.attempts[0].status='submitting',p=>delete p.clips[0].storyboard[0].continuityChecks['safe-image-references-storyboard-1'].reason,p=>p.error='fetch failed',p=>p.generationAuthorization={}]){const p=fixture();change(p);const before=structuredClone(p);assert.throws(()=>authorizeReferenceReviewResume(p),/no eligible/);assert.deepEqual(p,before);}
});
