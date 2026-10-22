import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
const root=path.resolve(import.meta.dirname,".."),dir=await fs.mkdtemp(path.join(os.tmpdir(),"slop-planning-"));
try{
  execFileSync(process.execPath,["--import",path.join(root,"tests/mock-planning-provider.mjs"),path.join(root,"services/worker.mjs")],{cwd:dir,env:{...process.env,OPENAI_API_KEY:"test",HF_KEY:"test",WORKER_SECRET:"test",WORKER_SITES_TOKEN:"",WORKER_APP_URL:"http://worker.test"},timeout:15000,stdio:"pipe"});
  if(process.env.TEST_SAVE_PENDING === "1") {
    const saved=JSON.parse(await fs.readFile(path.join(dir,"result.json"),"utf8"));assert.equal(saved.project.status,"failed");assert.ok(saved.project.pendingPlan);assert.equal(saved.calls,1);
    execFileSync(process.execPath,["--import",path.join(root,"tests/mock-planning-provider.mjs"),path.join(root,"services/worker.mjs")],{cwd:dir,env:{...process.env,TEST_SAVE_PENDING:"0",TEST_RESUME_SAVED:"1",OPENAI_API_KEY:"test",HF_KEY:"test",WORKER_SECRET:"test",WORKER_SITES_TOKEN:"",WORKER_APP_URL:"http://worker.test"},timeout:15000,stdio:"pipe"});
  }
  const {project,calls}=JSON.parse(await fs.readFile(path.join(dir,"result.json"),"utf8"));
  assert.equal(project.status,"planned",project.error);assert.equal(project.clips.length,10);assert.equal(calls,process.env.TEST_ASSET_IDENTITY === "1" && process.env.TEST_SAVE_PENDING !== "1" ? 2 : 1);assert.ok(project.planId);
  if(process.env.TEST_UPLOADED === "1") {
    assert.equal(project.assets.find(a=>a.id==="adult").imageKey,"source/assets/adult.png");
    assert.equal(project.assets.find(a=>a.id==="unused").imageKey,"source/assets/unused.png");
    assert.equal(project.assets.find(a=>a.id==="new-prop").imageKey,undefined);
    assert.equal(project.assets.find(a=>a.id==="adult").description,"Uploaded identity");
  } else assert.ok(project.assets.every(a=>!a.imageKey));
  if(process.env.TEST_ASSET_IDENTITY === "1") {assert.equal(project.assets.length,1);assert.equal(project.assets[0].description,"Original identity");assert.equal(project.pendingPlan,undefined);}
  console.log("PASS: real worker plans 40 paragraphs into exactly ten clips, then stops for runtime approval without generating images.");
}finally{await fs.rm(dir,{recursive:true,force:true});}
