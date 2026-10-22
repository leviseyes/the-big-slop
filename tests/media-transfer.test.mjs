import test from 'node:test';
import assert from 'node:assert/strict';
import {retryTransfer,checkTransferResponse} from '../services/media-transfer.mjs';
test('repeatable transfer retries timeout and server errors, returning one result',async()=>{
 let calls=0;const retries=[];
 const result=await retryTransfer(async()=>{calls++;if(calls===1)throw new DOMException('timeout','TimeoutError');if(calls===2)checkTransferResponse({ok:false,status:503});return 'stored';},{label:'Saving',onRetry:async n=>retries.push(n),sleep:async()=>{}});
 assert.equal(result,'stored');assert.equal(calls,3);assert.deepEqual(retries,[2,3]);
});
test('transfer retries are bounded; auth/validation failures fail immediately',async()=>{
 for(const status of [400,401,403,404,503]){let calls=0;await assert.rejects(retryTransfer(async()=>{calls++;checkTransferResponse({ok:false,status});},{label:'Saving clip',sleep:async()=>{}}),/Saving clip failed/);assert.equal(calls,status===503?3:1);}
});
import {deferredTransfer} from '../services/media-transfer.mjs';
import {publishReferenceImage,pendingReferenceTransfer,deferredReferenceTransfer,canResumeReferenceTransfer} from '../services/media-transfer.mjs';
test('saved reference survives a dropped upload and ticket connection without generating again',async()=>{
 let tickets=0,puts=0;const bytes=Buffer.from('saved image');
 const url=await publishReferenceImage(bytes,{
   sleep:async()=>{},
   createTicket:async()=>{tickets++;if(tickets===1)throw new TypeError('fetch failed');return {upload_url:`ticket-${tickets}`,public_url:`image-${tickets}`}},
   put:async(ticket,body)=>{assert.equal(body,bytes);puts++;if(puts===1)throw new TypeError('fetch failed');return {ok:true}},
 });
 assert.equal(url,'image-3');assert.equal(tickets,3);assert.equal(puts,2);
});
test('reference reconnects are bounded and never treat uncertain generation as a transfer',()=>{
 const p={id:'p',status:'failed',error:'fetch failed',runtimeApprovedAt:1,workStage:'references',assets:[{id:'a',imageKey:'p/assets/a.png',referenceUrl:'https://saved.example/a'},{id:'b',imageKey:'p/assets/b.png'},{id:'c'}]};
 assert.equal(pendingReferenceTransfer(p).id,'b');assert.equal(canResumeReferenceTransfer(p),true);
 assert.deepEqual(deferredReferenceTransfer(p,1000),{itemId:'b',count:1,after:61000});
 p.referenceTransferRecoveries={b:2};assert.equal(deferredReferenceTransfer(structuredClone(p),1000).after,241000);
 p.referenceTransferRecoveries.b=3;assert.throws(()=>deferredReferenceTransfer(p),/limit/);
 for(const update of [{status:'preparing'},{runtimeApprovedAt:null},{referencesApprovedAt:1},{generationAuthorization:{}},{workStage:'planning'},{assets:[{id:'b',imageKey:'other/assets/b.png'}]},{assets:[{id:'b',recovery:{reference:{attempts:[{status:'submitting'}]}}}]}])assert.equal(!!canResumeReferenceTransfer({...p,...update}),false);
});
test('upload authentication errors are actionable and do not retry or return a public URL',async()=>{
 let puts=0;
 await assert.rejects(publishReferenceImage(Buffer.from('saved'),{sleep:async()=>{},createTicket:async()=>({upload_url:'ticket',public_url:'not-yet-uploaded'}),put:async()=>{puts++;return {ok:false,status:403}}}),/Connecting your saved reference/);
 assert.equal(puts,1);
});
test('durable recovery only accepts known completed work and survives restart with a fixed limit',()=>{
 const p={clips:[{id:'clip-2',requestId:'existing',recovery:{video:{attempts:[{requestId:'existing',status:'complete',result:{video:{url:'https://media.example/video.mp4'}}}]}}}]};
 assert.deepEqual(deferredTransfer(p,1000),{itemId:'clip-2',count:1,after:61000});
 p.transferRecoveries={'clip-2':2};assert.equal(deferredTransfer(structuredClone(p),1000).after,241000);
 p.transferRecoveries['clip-2']=3;assert.throws(()=>deferredTransfer(p),/limit/);
 for(const clips of [[],[{id:'c',status:'submitting'}],[{id:'c',requestId:'submitted',recovery:{video:{attempts:[{requestId:'submitted',status:'submitted'}]}}}]])assert.throws(()=>deferredTransfer({clips}),/completed result/);
 assert.equal(deferredTransfer({clips:[{id:'c',videoKey:'saved.mp4'}]}).itemId,'assembly');
});
