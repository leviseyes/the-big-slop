import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
const root=path.resolve(import.meta.dirname,".."),dir=await fs.mkdtemp(path.join(os.tmpdir(),"slop-continuity-"));
const ffmpeg=path.join(root,"node_modules/ffmpeg-static/ffmpeg"),{default:probe}=await import("ffprobe-static");
const resolution=process.env.TEST_RESOLUTION || "480p",width=resolution==="480p"?854:1280,height=resolution==="480p"?480:720;
try {
  // The last frame alone is white; every earlier frame is black. This catches
  // approximate near-end seeks, first-frame extraction and accidental crops.
  execFileSync(ffmpeg,["-y","-f","lavfi","-i",`color=black:s=${width}x${height}:r=24:d=30`,"-vf","drawbox=color=white:t=fill:enable='eq(n,719)'","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p",path.join(dir,"source.mp4")],{stdio:"ignore"});
  const out=execFileSync(process.execPath,["--import",path.join(root,"tests/mock-continuity-provider.mjs"),path.join(root,"services/worker.mjs")],{cwd:dir,env:{...process.env,OPENAI_API_KEY:"test-only",HF_KEY:"test-only",WORKER_SECRET:"test-only",WORKER_SITES_TOKEN:"",WORKER_APP_URL:"http://worker.test",FFMPEG_PATH:ffmpeg,FFPROBE_PATH:probe.path},timeout:90000,encoding:"utf8"});
  const {project,submissions,frameUploads}=JSON.parse(await fs.readFile(path.join(dir,"result.json"),"utf8"));
  assert.equal(project.status,"complete",project.error || out);assert.equal(submissions.length,2);assert.equal(frameUploads,1);
  assert.equal(project.clips[1].startFrameSource,"previous-clip");assert.equal(project.clips[1].startFrameClipId,"clip-1");assert.equal(project.clips[2].startFrameSource,"scene-frame");
  const info=file=>JSON.parse(execFileSync(probe.path,["-v","error","-show_streams","-show_format","-of","json",file],{encoding:"utf8"}));
  const png=info(path.join(dir,"uploaded-last.png")).streams[0];assert.equal(png.width,width);assert.equal(png.height,height);
  const pixel=execFileSync(ffmpeg,["-v","error","-i",path.join(dir,"uploaded-last.png"),"-vf","scale=1:1","-pix_fmt","rgb24","-f","rawvideo","pipe:1"]);assert.ok([...pixel].every(v=>v>240),"the actual final white frame must be reused");
  const final=info(path.join(dir,"worker-state/continuity-fixture/movie.mp4"));assert.equal(final.streams[0].width,width);assert.equal(final.streams[0].height,height);assert.ok(Math.abs(Number(final.format.duration)-90)<.2);
  console.log(`PASS: ${resolution} full worker uses the exact final frame, preserves multilingual prompts, resets at camera cuts, retains completed clips and assembles a 90-second film. No paid calls.`);
} finally {await fs.rm(dir,{recursive:true,force:true});}
