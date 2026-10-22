import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {checkpointReceipt,checkpointDisposition} from '../services/checkpoint-order.mjs';

// Execute the actual route and its SQL against SQLite, injecting only platform
// dependencies. Interleave requests at the write boundary to reproduce races.
const source=ts.transpileModule(readFileSync(new URL('../app/api/worker/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
 .replace(/import[\s\S]*?from\s+["'][^"']+["'];/g,'').replace(/export /g,'');
function studio() {
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE productions(id TEXT PRIMARY KEY,owner TEXT,data TEXT,status TEXT,version INTEGER,updated INTEGER);
 CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,kind TEXT,status TEXT,lease TEXT,lease_until INTEGER);`);
 const initial={id:'p',title:'Original',script:'Saved script',status:'preparing',assets:[],clips:[],workflowVersion:1};
 sql.prepare('INSERT INTO productions VALUES(?,?,?,?,?,?)').run('p','owner',JSON.stringify(initial),'preparing',1,0);
 sql.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?)').run('j','p','prepare','running','lease',Date.now()+120000);
 let beforeBatch;
 const db = {
  prepare(query) {
   return {bind(...values) {
    return {
     first: async()=>sql.prepare(query).get(...values),
     run: async()=>({meta:{changes:Number(sql.prepare(query).run(...values).changes)}}),
    };
   }};
  },
  async batch(statements) {
   if(beforeBatch){const hook=beforeBatch;beforeBatch=undefined;await hook();}
   sql.exec('BEGIN');
   try {const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}
   catch(e){sql.exec('ROLLBACK');throw e;}
  },
 };
 const row=()=>{const r=sql.prepare('SELECT * FROM productions WHERE id=?').get('p');return {...r,project:JSON.parse(r.data)};};
 class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
 const deps={checkpointReceipt,checkpointDisposition,db:()=>db,workerAuth:async()=>{},getProject:async()=>row(),AppError,json:(x,status=200)=>Response.json(x,{status}),failure:e=>Response.json({error:e.message},{status:e.status||500}),productionSettings:()=>({}),referenceStatements:()=>[],targetClipCount:()=>0};
 const {POST}=new Function(...Object.keys(deps),source+';return {POST};')(...Object.values(deps));
 const payload=(sequence,phase='Drawing',action='checkpoint')=>({action,jobId:'j',lease:'lease',saveSequence:sequence,project:{...initial,phase}});
 const post=body=>POST(new Request('https://studio.test/api/worker',{method:'POST',body:JSON.stringify(body)}));
 return {sql,row,payload,post,interleave:hook=>{beforeBatch=hook;}};
}
test('overlapping retry acknowledges one committed checkpoint instead of pausing',async()=>{
 const s=studio(),body=s.payload(1);
 s.interleave(async()=>assert.equal((await s.post(body)).status,200));
 const r=await s.post(body);assert.equal(r.status,200);assert.equal((await r.json()).alreadySaved,true);assert.equal(s.row().version,2);assert.equal(s.row().status,'preparing');s.sql.close();
});
test('delayed old checkpoint cannot replace newer progress',async()=>{
 const s=studio(),old=s.payload(1,'Old'),next=s.payload(2,'New image saved');
 s.interleave(async()=>{assert.equal((await s.post(old)).status,200);assert.equal((await s.post(next)).status,200);});
 assert.equal((await s.post(old)).status,409);assert.equal(s.row().project.phase,'New image saved');assert.equal(s.row().version,3);s.sql.close();
});
test('version collision re-reads server metadata before saving',async()=>{
 const s=studio();s.interleave(async()=>{const p=s.row().project;p.title='User title';s.sql.prepare('UPDATE productions SET data=?,version=version+1').run(JSON.stringify(p));});
 assert.equal((await s.post(s.payload(1))).status,200);assert.equal(s.row().project.title,'User title');assert.equal(s.row().version,3);s.sql.close();
});
test('changed script or lost lease during a collision cannot be overwritten',async()=>{
 for(const mutation of ['script','lease','expiry']){const s=studio();s.interleave(async()=>{if(mutation==='lease')s.sql.prepare('UPDATE jobs SET lease=?').run('another-worker');else if(mutation==='expiry')s.sql.exec('UPDATE jobs SET lease_until=0');else {const p=s.row().project;p.script='Changed';s.sql.prepare('UPDATE productions SET data=?,version=version+1').run(JSON.stringify(p));}});
 const r=await s.post(s.payload(1));assert.ok([400,409].includes(r.status));assert.equal(s.row().project.workerSave,undefined);s.sql.close();}
});
test('legacy clients still save and invalid sequence values are rejected',async()=>{
 const s=studio(),body=s.payload(1);delete body.saveSequence;
 assert.equal((await s.post(body)).status,200);
 for(const seq of [0,-1,1.2,'1'])assert.equal((await s.post(s.payload(seq))).status,400);
 s.sql.close();
});
test('reusing a sequence with different content is rejected and completion remains atomic',async()=>{
 const s=studio();assert.equal((await s.post(s.payload(1))).status,200);assert.equal((await s.post(s.payload(1,'Different'))).status,409);
 const finish=s.payload(2,'Review','finish');finish.project.status='references_ready';assert.equal((await s.post(finish)).status,200);
 assert.equal(s.row().status,'references_ready');assert.equal(s.sql.prepare('SELECT status FROM jobs').get().status,'complete');assert.equal((await s.post(s.payload(3))).status,409);s.sql.close();
});
test('persistent collisions stop after four writes without clobbering state',async()=>{
 const s=studio();let attempts=0;const collision=async()=>{attempts++;s.sql.exec('UPDATE productions SET version=version+1');s.interleave(collision);};s.interleave(collision);
 assert.equal((await s.post(s.payload(1))).status,409);assert.equal(attempts,4);assert.equal(s.row().project.workerSave,undefined);s.sql.close();
});
