import fs from "node:fs/promises";
import assert from "node:assert/strict";
let calls=0;
let p={id:"planning-fixture",title:"Five minute film",script:Array.from({length:40},(_,i)=>`Action ${i}. An adult looks out of the window.`).join("\n\n"),style:"Cinematic",status:"planning",workflowVersion:3,targetMinutes:5,assets:[],clips:[]};
if(process.env.TEST_ASSET_IDENTITY === "1") p.assets=[{id:"adult",name:"Adult in blue",kind:"character",description:"Original identity",prompt:"Original reference"}];
if(process.env.TEST_UPLOADED === "1") p.assets=[{id:"adult",name:"Adult",kind:"character",description:"Uploaded identity",prompt:"Use supplied face",source:"upload",imageKey:"source/assets/adult.png"},{id:"unused",name:"Unused prop",kind:"object",description:"Keep uploaded item",source:"upload",imageKey:"source/assets/unused.png"}];
if(process.env.TEST_RESUME_SAVED === "1") {p=JSON.parse(await fs.readFile("result.json","utf8")).project;p.status="planning";}
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),b=JSON.parse(options.body || "{}");
  if(u.origin==="http://worker.test"){
    if(b.action==="claim")return Response.json({job:{id:"job",lease:"lease",kind:"prepare"},project:p});
    if(b.action==="checkpoint"||b.action==="finish"){
      p=structuredClone(b.project);
      if(b.action === "checkpoint" && p.pendingPlan && process.env.TEST_SAVE_PENDING === "1") throw new Error("Simulated interruption after saved plan");
      if(b.action==="finish"){await fs.writeFile("result.json",JSON.stringify({project:p,calls}));process.emit("SIGTERM");}
      return Response.json({ok:true});
    }
    if(b.action==="heartbeat")return Response.json({ok:true});
  }
  if(u.href==="https://api.openai.com/v1/responses"){
    calls++;
    if(b.text.format.name === "asset_identity_resolution") {
      assert.equal(JSON.parse(b.input).incoming[0].id,"adult");
      return Response.json({id:"resp_test_planning",status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify({decisions:[{sourceId:"adult",existingId:"adult"}]})}]}]});
    }
    assert.match(b.instructions,/exactly 10 consecutive 30-second clips/);
    assert.match(b.instructions,/SPOKEN AUDIO LANGUAGE: English ONLY/);
    assert.match(b.instructions,/productionBible/);
    const blocks=JSON.parse(b.input);
    const clips=Array.from({length:10},(_,i)=>({blockIds:blocks.slice(i*4,i*4+4).map(b=>b.id),assetIds:process.env.TEST_UPLOADED === "1" ? ["adult","new-prop"] : ["adult"],prompt:`Clip ${i+1}: combine four actions into one thirty-second scene.`,sceneId:"scene-1",locationId:"room",cameraId:"wide",timeOfDay:"day",endSceneId:"scene-1",endLocationId:"room",endCameraId:"wide",endTimeOfDay:"day",transition:i?"continue":"cut",transitionReason:i?"Continuous action":"Opening shot",openingState:"An adult at the window",closingState:"An adult at the window",actionBeats:"0–10s look up; 10–20s turn; 20–30s settle.",dialogue:[],renderedText:[],storyboard:[{start:0,end:30,composition:"Wide view of the adult at the window",action:"Looks up, turns, then settles",audio:"Room tone"}]}));
    return Response.json({id:"resp_test_planning",status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify({productionBible:"Soft daylight, fixed wide lens, blue wardrobe, calm voice.",assets:[{id:"adult",name:"Adult",kind:"character",description:"An adult in blue",prompt:"Adult in blue"},...(process.env.TEST_UPLOADED === "1"?[{id:"new-prop",name:"New prop",kind:"object",description:"Missing prop",prompt:"A new prop"}]:[])],clips})}]}]});
  }
  throw new Error(`Image generation or unexpected network request blocked before plan approval: ${u.href}`);
};
