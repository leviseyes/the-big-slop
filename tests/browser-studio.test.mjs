import test from 'node:test';
import assert from 'node:assert/strict';
import {browserStudioRequest} from '../services/browser-studio.mjs';
test('read-only connection failures retry and return fresh saved progress',async()=>{
 let calls=0;const result=await browserStudioRequest('get',{id:'p'},{sleep:async()=>{},fetch:async()=>{if(++calls<3)throw new TypeError('Failed to fetch');return Response.json({project:{id:'p',phase:'still drawing'}});}});assert.equal(calls,3);assert.equal(result.project.phase,'still drawing');
});
test('generation, payment and editing actions never repeat after ambiguous connection failure',async()=>{
 for(const action of ['prepare','approveGeneration','checkout','reviseReferences','save']){let calls=0;await assert.rejects(browserStudioRequest(action,{},{fetch:async()=>{calls++;throw new TypeError('Failed to fetch');}}),/Check your production/);assert.equal(calls,1);}
});
test('failed reads stay bounded; authorization failures are not disguised as reconnects',async()=>{
 let calls=0;await assert.rejects(browserStudioRequest('get',{},{sleep:async()=>{},fetch:async()=>{calls++;return Response.json({error:'offline'},{status:503});}}),e=>e.connection===true);assert.equal(calls,3);
 calls=0;await assert.rejects(browserStudioRequest('get',{},{fetch:async()=>{calls++;return Response.json({error:'Sign in again'},{status:401});}}),/Sign in again/);assert.equal(calls,1);
});
test('cancellation stops a retry before switching to another production',async()=>{
 let calls=0;const controller=new AbortController();await assert.rejects(browserStudioRequest('get',{id:'old'},{signal:controller.signal,sleep:async()=>controller.abort(),fetch:async()=>{calls++;throw new TypeError('Failed to fetch');}}),e=>e.name==='AbortError');assert.equal(calls,1);
});
