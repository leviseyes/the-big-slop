import fs from "node:fs/promises";
import assert from "node:assert/strict";
const now=Date.now(), media=new Map(), submissions=[];
let frameUploads=0;
const shared={sceneId:"s1",locationId:"room",cameraId:"wide",timeOfDay:"day",openingState:"An empty room",closingState:"An empty room",actionBeats:"Hold a quiet shot.",dialogue:[{speaker:"Narrator",language:"Spanish",text:"Buenos días",delivery:"calm"}],renderedText:[{language:"English",text:"OPEN",placement:"door"}],assetIds:[]};
let p={id:"continuity-fixture",style:"Cinematic",productionBible:"Warm lighting and a stable camera",resolution:process.env.TEST_RESOLUTION || "480p",dialogueLanguages:["English","Spanish"],textLanguages:["English"],status:"queued",assets:[],quote:{id:"q",providerCents:300,totalCents:300},consent:{quoteId:"q",acceptedAt:now,totalCents:300},generationAuthorization:{kind:"owner-funded",quoteId:"q",providerCents:300,approvedAt:now},clips:[
  {...shared,id:"clip-1",prompt:"Empty room",transition:"cut",estimatedUsd:1,status:"complete",videoKey:"continuity-fixture/clips/clip-1.mp4"},
  {...shared,id:"clip-2",prompt:"Continue the room shot",transition:"continue",estimatedUsd:1,status:"planned",frameUrl:"https://media.example/scene-2.png",input:{duration:30,resolution:process.env.TEST_RESOLUTION || "480p"}},
  {...shared,id:"clip-3",prompt:"A close-up",cameraId:"close-up",transition:"cut",estimatedUsd:1,status:"planned",frameUrl:"https://media.example/scene-3.png",input:{duration:30,resolution:process.env.TEST_RESOLUTION || "480p"}},
]};
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.origin==="http://worker.test") {
    const key=u.searchParams.get("key");
    if(options.method==="PUT") {media.set(key,Buffer.from(options.body));return Response.json({ok:true});}
    if(!options.method || options.method==="GET")return new Response(media.get(key) || await fs.readFile("source.mp4"));
    const b=JSON.parse(options.body);
    if(b.action==="claim")return Response.json({job:{id:"job",lease:"lease",kind:"render"},project:p});
    if(b.action==="heartbeat")return Response.json({ok:true});
    if(b.action==="checkpoint" || b.action==="finish") {
      p=structuredClone(b.project);
      if(b.action==="finish") {await fs.writeFile("result.json",JSON.stringify({project:p,submissions,frameUploads}));process.emit("SIGTERM");}
      return Response.json({ok:true});
    }
  }
  if(u.origin==="https://api.higgsfield.ai") {
    const b=JSON.parse(options.body || "{}");
    if(u.pathname.startsWith("/estimate/")){assert.equal(b.resolution,p.resolution);return Response.json({usd:1});}
    if(u.pathname==="/files/generate-upload-url")return Response.json({upload_url:"https://media.example/upload",public_url:"https://media.example/last-frame.png"});
    if(u.pathname==="/bytedance/seedance-2.5/image-to-video") {
      assert.equal(b.resolution,p.resolution);assert.equal(b.duration,30);
      assert.match(b.prompt,/English, Spanish ONLY/);assert.match(b.prompt,/ON-SCREEN TEXT LANGUAGES: English ONLY/);
      assert.match(b.prompt,/Buenos días/);assert.match(b.prompt,/Warm lighting/);
      if(!submissions.length) {assert.equal(b.image_url,"https://media.example/last-frame.png");assert.match(b.prompt,/actual final frame/);}
      else {assert.equal(b.image_url,"https://media.example/scene-3.png");assert.doesNotMatch(b.prompt,/actual final frame/);}
      submissions.push(b);return Response.json({request_id:`r${submissions.length}`});
    }
    if(u.pathname.startsWith("/requests/"))return Response.json({status:"completed",video:{url:"https://media.example/video.mp4"}});
  }
  if(u.origin==="https://media.example") {
    if(options.method==="PUT"){frameUploads++;await fs.writeFile("uploaded-last.png",Buffer.from(options.body));return new Response(null,{status:200});}
    if(u.pathname==="/video.mp4")return new Response(await fs.readFile("source.mp4"));
  }
  throw new Error(`Unexpected external request blocked: ${u.origin}${u.pathname}`);
};
