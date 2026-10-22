import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeSafeWardrobeRecovery, LEGACY_REFERENCE_STOP, adoptAcceptedWardrobe } from '../services/safe-adaptation.mjs';
import { recoverGeneration, RejectedGeneration } from '../services/recovery.mjs';
const production=()=>({status:'failed',error:LEGACY_REFERENCE_STOP,workStage:'storyboards',runtimeApprovedAt:1,referencesApprovedAt:2,storyboardsApprovedAt:3,quote:{id:'old'},assets:[{id:'alex',name:'Alex',kind:'character',imageKey:'p/alex.png',referenceUrl:'https://alex',description:'Established Alex'},{id:'riley',name:'Riley',kind:'character',imageKey:'p/riley.png'}],clips:[{id:'c1',assetIds:['alex'],frameKey:'p/f.png',storyboard:[{composition:'Alex nude in room',action:'Alex standing',recovery:{storyboard:{textOnly:true,startedAt:1,attempts:[{status:'rejected',policy:true,repaired:true},{status:'submitting'}]}}}]},{id:'c2',assetIds:['riley'],storyboard:[{imageKey:'p/other.png',referenceUrl:'https://other',approvedImageKey:'p/other.png'}]}]});
test('wardrobe repair preserves identity sources and unrelated boards and resets required approvals',()=>{
 const p=production();authorizeSafeWardrobeRecovery(p,'alex',10);
 assert.equal(p.assets[2].editSourceKey,'p/alex.png');assert.equal(p.assets[2].imageKey,undefined);assert.equal(p.assets[0].imageKey,'p/alex.png');assert.deepEqual(p.clips[0].assetIds,['alex-safe-swimwear']);
 assert.equal(p.clips[1].storyboard[0].approvedImageKey,'p/other.png');assert.equal(p.clips[0].storyboard[0].imageKey,undefined);
 assert.equal(p.clips[0].previousStoryboardVersions[0].storyboard[0].recovery.storyboard.attempts.at(-1).localPreflightOnly,true);
 assert.equal(p.referencesApprovedAt,undefined);assert.equal(p.storyboardsApprovedAt,undefined);assert.equal(p.quote,undefined);assert.equal(p.clips[0].needsSafeDirection,true);
 assert.throws(()=>authorizeSafeWardrobeRecovery(p,'alex',20),/not eligible/);
});
test('unknown outcomes, changed identities and approved renders cannot use legacy exception',()=>{
 for(const change of [p=>p.error='fetch failed',p=>p.clips[0].storyboard[0].recovery.storyboard.attempts[0].policy=false,p=>p.generationAuthorization={},p=>p.assets[0].id='someone-else',p=>p.clips[0].storyboard[0].recovery.storyboard.attempts[1].requestId='req_x']) {
 const p=production();change(p);const before=structuredClone(p);assert.throws(()=>authorizeSafeWardrobeRecovery(p,'alex'));assert.deepEqual(p,before);
 }
});
test('policy image retry reviews references before submitting and preserves attachments',async()=>{
 const state={},refs=['same-character','same-room'];let calls=0,checks=0;
 const result=await recoverGeneration({state,prompt:'original',checkpoint:async()=>{},sleep:async()=>{},rewrite:async()=>({canProceed:true,prompt:'Safe clothed reaction',summary:'Changed unsafe action'}),beforeSubmit:async s=>{if(s.textOnly){checks++;assert.deepEqual(refs,['same-character','same-room']);}},execute:async()=>{if(++calls===1)throw new RejectedGeneration('policy',{policy:true});return 'saved-image';}});
 assert.equal(result,'saved-image');assert.equal(checks,1);assert.equal(calls,2);
});
test('failed reference preflight leaves no ambiguous generation attempt',async()=>{
 const state={};let submits=0;
 await assert.rejects(recoverGeneration({state,prompt:'safe',checkpoint:async()=>{},rewrite:async()=>{},beforeSubmit:async()=>{throw Error('References need review');},execute:async()=>{submits++;}}),/References need review/);
 assert.equal(submits,0);assert.equal(state.attempts.length,0);
});

test('clothed Alex scenes retain finished panels and the corrected rejected prompt',()=>{
 const p=production();p.clips[0].storyboard[0].composition='Fully clothed Alex by a car';p.clips[0].storyboard[0].action='Alex watches the street';
 p.clips.push({id:'clothed',assetIds:['alex'],storyboard:[{imageKey:'saved.png',referenceUrl:'https://saved',composition:'Alex wears a dress',action:'walks'}]});
 authorizeSafeWardrobeRecovery(p,'alex',10);
 assert.equal(p.clips[2].storyboard[0].imageKey,'saved.png');assert.equal(p.clips[0].storyboard[0].recovery.storyboard.attempts.at(-1).localPreflightOnly,true);
 assert.equal(p.clips[0].needsSafeDirection,undefined);
});

test('accepted fallback becomes the wardrobe authority instead of repeating the rejected request',()=>{
 const p={safetyDirection:'Requested swimsuit'},a={identityAssetId:'alex',name:'Alex — swimsuit wardrobe',imageKey:'safe.png',recovery:{reference:{attempts:[{status:'complete'}],summary:'Used a fully clothed fallback.'}}};
 assert.equal(adoptAcceptedWardrobe(p,a),true);assert.equal(p.requestedSafetyDirection,'Requested swimsuit');assert.match(p.safetyDirection,/clothing actually shown/);assert.equal(a.name,'Alex — safe wardrobe');assert.match(p.safetyWardrobeNote,/fully clothed/);
});
