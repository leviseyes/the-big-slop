import test from 'node:test';
import assert from 'node:assert/strict';
import {durableDirector} from '../services/director-connection.mjs';
const sleep=async()=>{};
test('background request saves its ID and survives a dropped polling connection',async()=>{
 const state={},paths=[];let gets=0;const saved=[];
 const r=await durableDirector(state,{store:false},{sleep,checkpoint:async()=>saved.push({...state}),call:async(path,body)=>{paths.push(path);if(body){assert.equal(body.background,true);assert.equal(body.store,true);return {id:'resp_test',status:'queued'};}if(!gets++) throw new TypeError('fetch failed');return {id:'resp_test',status:'completed'};}});
 assert.equal(r.status,'completed');assert.equal(paths.filter(x=>x==='responses').length,1);assert.ok(saved.some(s=>s.id==='resp_test'));
});
test('saved request resumes by GET without another paid submission',async()=>{
 const state={id:'resp_saved'};await durableDirector(state,{}, {sleep,checkpoint:async()=>{},call:async(path,body)=>{assert.equal(body,undefined);assert.equal(path,'responses/resp_saved');return {status:'completed'};}});
});
test('unknown submission never retries creation automatically',async()=>{
 const state={};let calls=0;const options={sleep,checkpoint:async()=>{},call:async()=>{calls++;throw new TypeError('fetch failed');}};
 await assert.rejects(durableDirector(state,{},options),/outcome is unknown/);
 await assert.rejects(durableDirector(state,{},options),/avoid duplicate charges/);assert.equal(calls,1);
});
test('ID survives a failed checkpoint and is reused on reconnection',async()=>{
 const state={};await assert.rejects(durableDirector(state,{}, {sleep,checkpoint:async()=>{if(state.id)throw new Error('lost connection');},call:async()=>({id:'resp_safe',status:'queued'})}));
 assert.equal(state.id,'resp_safe');
 await durableDirector(state,{}, {sleep,checkpoint:async()=>{},call:async(path,body)=>{assert.equal(body,undefined);return {status:'completed'};}});
});
