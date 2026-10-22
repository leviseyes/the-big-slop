import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'slop-reference-'));
const ffmpeg=path.join(root,'node_modules/ffmpeg-static/ffmpeg');
try{
 execFileSync(ffmpeg,['-f','lavfi','-i','color=c=blue:s=1024x1024','-frames:v','1',path.join(dir,'frame.png')],{stdio:'ignore'});
 // A stale cached reference must not be reused for the revised scene.
 await fs.mkdir(path.join(dir,'worker-state/reference-fixture'),{recursive:true});
 await fs.writeFile(path.join(dir,'worker-state/reference-fixture/adult.png'),'STALE');
 execFileSync(process.execPath,['--import',path.join(root,'tests/mock-reference-provider.mjs'),path.join(root,'services/worker.mjs')],{cwd:dir,env:{...process.env,OPENAI_API_KEY:'test',HF_KEY:'test',WORKER_SECRET:'test',WORKER_SITES_TOKEN:'',WORKER_APP_URL:'http://worker.test',FFMPEG_PATH:ffmpeg},timeout:20000,stdio:'pipe'});
 const {project:p,images,uploads}=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));
 assert.equal(p.status,'references_ready',p.error);assert.equal(images,1);assert.deepEqual(uploads.filter(key=>key.endsWith('.png')),['reference-fixture/assets/adult-v1.png']);
 assert.equal(p.clips[1].frameKey,'reference-fixture/keep.png');assert.equal(p.clips[1].frameUrl,'https://media.example/keep.png');assert.equal(p.quote,undefined);assert.equal(p.referencesApprovedAt,undefined);
 console.log('PASS: real worker edits a reference, replaces stale cached input, retains unrelated frames, and stops for reference review before any further generation. Zero external requests.');
}finally{await fs.rm(dir,{recursive:true,force:true});}
