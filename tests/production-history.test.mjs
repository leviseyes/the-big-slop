import test from 'node:test';
import assert from 'node:assert/strict';
import {compactImageHistory,publicProduction} from '../services/production-history.mjs';
import {recoverGeneration} from '../services/recovery.mjs';
const state=(result)=>({prompt:'Long original generation prompt. '.repeat(300),lastRevision:{prompt:'Safe revision '.repeat(300)},startedAt:1,summary:'Approved adaptation',attempts:[{number:1,status:'rejected',error:'Rejected'},{number:2,status:'complete',result}]});
const fixture=()=>({id:'p',script:'keep script',referencesApprovedAt:1,assets:[{id:'a',description:'keep identity',imageKey:'p/assets/a.png',recovery:{reference:state('p/assets/a.png')}}],clips:[{id:'c',prompt:'keep scene prompt',storyboard:[{imageKey:'p/storyboards/s.png',composition:'keep composition',approvedImageKey:'p/storyboards/s.png',recovery:{storyboard:state('p/storyboards/s.png')}},{recovery:{storyboard:{prompt:'pending',attempts:[{status:'submitting',requestId:'known'}]}}}]}]});
test('completed image history is archived losslessly while active state shrinks and known results remain usable',async()=>{
 const p=fixture(),before=structuredClone(p),files=new Map();
 const result=await compactImageHistory(p,async(key,text)=>files.set(key,text));
 assert.equal(result.archived,2);assert.ok(result.after<result.before/4);
 const archived=p.assets[0].recovery.reference;
 const file=JSON.parse(files.get(archived.archivedKey));assert.equal(file.projectId,'p');assert.deepEqual(file.entries[archived.archivedEntry].state,before.assets[0].recovery.reference);
 assert.equal(await recoverGeneration({state:archived,prompt:'unused',checkpoint:async()=>{},execute:async()=>assert.fail('must reuse stored result')}),'p/assets/a.png');
 assert.deepEqual(p.clips[0].storyboard[1],before.clips[0].storyboard[1]);assert.equal(p.clips[0].prompt,before.clips[0].prompt);assert.equal(p.clips[0].storyboard[0].approvedImageKey,'p/storyboards/s.png');
 assert.equal((await compactImageHistory(p,async()=>assert.fail('already archived'))).archived,0);
});
test('failed archive leaves all original histories intact',async()=>{
 const p=fixture(),before=structuredClone(p);await assert.rejects(compactImageHistory(p,async()=>{throw new Error('storage unavailable');}));assert.deepEqual(p,before);
});
test('no compaction of pending, unstored or foreign-production media',async()=>{
 for(const change of [p=>delete p.assets[0].imageKey,p=>p.assets[0].imageKey='another/assets/a.png',p=>p.assets[0].recovery.reference.attempts.at(-1).status='submitting']){
  const p=fixture();p.clips=[];change(p);const before=structuredClone(p);assert.equal((await compactImageHistory(p,async()=>assert.fail('not eligible'))).archived,0);assert.deepEqual(p,before);
 }
});
test('browser projection preserves review data and does not change canonical production state',()=>{
 const p=fixture();p.directorRequests={one:{id:'resp_saved'}};p.workerSave={sequence:3};const before=structuredClone(p),view=publicProduction(p);
 assert.equal(view.assets[0].recovery,undefined);assert.equal(view.clips[0].storyboard[1].recovery,undefined);assert.equal(view.directorRequests,undefined);assert.equal(view.workerSave,undefined);assert.equal(view.script,p.script);assert.equal(view.clips[0].prompt,p.clips[0].prompt);assert.equal(view.referencesApprovedAt,1);assert.deepEqual(p,before);
});
