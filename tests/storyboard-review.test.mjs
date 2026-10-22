import test from 'node:test';
import assert from 'node:assert/strict';
import {boardsApproved,reviewStoryboard} from '../services/storyboard-review.mjs';
const make=()=>({status:'storyboards_ready',clips:[{id:'c1',storyboard:[{imageKey:'board.png',referenceUrl:'https://example.test/board',composition:'Wide room',action:'Walk forward',audio:'Hello'}]}]});
test('every current panel must be accepted',()=>{
 const p=make(); assert.equal(boardsApproved(p),false);
 const accepted=reviewStoryboard(p,{action:'acceptStoryboard',clipId:'c1',shotIndex:0,imageKey:'board.png'});
 assert.equal(boardsApproved(accepted),true);assert.equal(boardsApproved(p),false);
 accepted.clips[0].storyboard.push({imageKey:'other',referenceUrl:'other'});assert.equal(boardsApproved(accepted),false);
});
const bulkInput=p=>({action:'acceptAllStoryboards',shots:p.clips.flatMap(c=>(c.storyboard||[]).map((s,shotIndex)=>({clipId:c.id,shotIndex,imageKey:s.imageKey})))});
test('bulk accepts every current version without advancing or changing production content',()=>{
 const p=make();p.clips.push({id:'c2',storyboard:[{imageKey:'second.png',referenceUrl:'second',composition:'Close',action:'Turn'}]});
 const next=reviewStoryboard(p,bulkInput(p));
 assert.equal(boardsApproved(next),true);assert.equal(boardsApproved(p),false);
 assert.equal(next.status,'storyboards_ready');assert.equal(next.storyboardsApprovedAt,undefined);
 assert.equal(next.clips[1].storyboard[0].composition,'Close');
 assert.deepEqual(reviewStoryboard(next,bulkInput(next)),next);
 const revised=reviewStoryboard(next,{action:'reviseStoryboard',clipId:'c2',shotIndex:0,imageKey:'second.png',composition:'Wide frame',direction:'Walk away'});
 assert.equal(boardsApproved(revised),false);assert.equal(revised.clips[0].storyboard[0].approvedImageKey,'board.png');
});
test('bulk rejects stale or incomplete snapshots atomically',()=>{
 for(const change of [
   p=>{p.clips[0].storyboard[0].imageKey='new.png';},
   p=>{p.clips[0].storyboard.push({imageKey:'extra',referenceUrl:'extra'});},
   p=>{delete p.clips[0].storyboard[0].referenceUrl;},
   p=>{p.clips.push({id:'empty',storyboard:[]});},
 ]) {
   const p=make(),input=bulkInput(p);change(p);
   assert.throws(()=>reviewStoryboard(p,input),/changed|ready/);
   assert.equal(p.clips[0].storyboard[0].approvedImageKey,undefined);
 }
 assert.throws(()=>reviewStoryboard(make(),{action:'acceptAllStoryboards'}),/changed/);
 for(const field of ['paidAt','generationAuthorization','checkoutId']) {
   const p=make();p[field]=true;assert.throws(()=>reviewStoryboard(p,bulkInput(p)),/before committing/);
 }
 const p=make();p.status='preparing';assert.throws(()=>reviewStoryboard(p,bulkInput(p)),/after drawing finishes/);
});
test('changed shot loses approval and quote, preserving other completed work',()=>{
 const p=make();p.storyboardsApprovedAt=1;p.quote={id:'quote'};p.clips[0].frameUrl='frame';
 const next=reviewStoryboard(p,{action:'reviseStoryboard',clipId:'c1',shotIndex:0,imageKey:'board.png',composition:'Close shot',direction:'Turn left'});
 assert.equal(next.status,'preparing');assert.equal(next.quote,undefined);assert.equal(next.storyboardsApprovedAt,undefined);assert.equal(next.clips[0].storyboard[0].audio,'Hello');assert.equal(next.clips[0].frameUrl,undefined);assert.equal(boardsApproved(next),false);
});
test('stale panels and committed productions cannot be edited or accepted',()=>{
 const input={action:'acceptStoryboard',clipId:'c1',shotIndex:0,imageKey:'stale'};
 assert.throws(()=>reviewStoryboard(make(),input),/changed/);
 for(const field of ['paidAt','generationAuthorization','checkoutId']) {const p=make();p[field]=true;assert.throws(()=>reviewStoryboard(p,{...input,imageKey:'board.png'}),/before committing/);}
});
