import test from "node:test";
import assert from "node:assert/strict";
import { productionSettings, textInstruction, dialogueInstruction, continuesPreviousShot, validateDirection, videoDimensions } from "../services/production-direction.mjs";
import { clipBody, estimateUsd } from "../services/production-core.mjs";
const shot = {prompt:"Walk to the door.",frameUrl:"https://media.example/frame.png",sceneId:"s1",locationId:"room",cameraId:"wide",timeOfDay:"day",endSceneId:"s1",endLocationId:"room",endCameraId:"wide",endTimeOfDay:"day",transition:"continue",transitionReason:"Same uninterrupted shot",openingState:"At the window",closingState:"At the door",actionBeats:"0–10s turn; 10–20s walk; 20–30s stop",dialogue:[],renderedText:[]};
test("multiple languages, silent films and text choices remain independent", () => {
  const p={dialogueLanguages:["English","Spanish"],textLanguages:["Hebrew"],resolution:"480p"};
  assert.match(dialogueInstruction(p),/English, Spanish ONLY/);
  assert.match(textInstruction(p),/Hebrew ONLY/);
  assert.match(dialogueInstruction({dialogueLanguages:[]}),/SPOKEN AUDIO: NONE/);
  assert.match(textInstruction({textLanguages:[]}),/ON-SCREEN TEXT: NONE/);
  assert.deepEqual(productionSettings({dialogueLanguage:"French"}).dialogueLanguages,["French"]);
  assert.throws(()=>productionSettings({...p,dialogueLanguages:["English","English"]}));
  assert.throws(()=>productionSettings({...p,resolution:"1080p"}));
  assert.throws(()=>videoDimensions("1080p"));
  const body=clipBody(shot,[],p,"Safe revised scene");
  assert.equal(body.resolution,"480p");assert.match(body.prompt,/Hebrew ONLY/);assert.match(body.prompt,/English, Spanish ONLY/);
});
test("last-frame continuation requires matching scene, location, camera and time", () => {
  assert.equal(continuesPreviousShot(shot,shot),true);
  assert.equal(continuesPreviousShot(shot,undefined),false);
  for(const key of ["sceneId","locationId","cameraId","timeOfDay"]) assert.equal(continuesPreviousShot({...shot,[key]:"different"},shot),false);
  assert.equal(continuesPreviousShot({...shot,transition:"cut"},shot),false);
  assert.equal(continuesPreviousShot(shot,{...shot,endCameraId:"close-up"}),false,"use the previous ENDING camera, including internal cuts");
  assert.equal(continuesPreviousShot({...shot,cameraId:"close-up"},{...shot,endCameraId:"close-up"}),true);
  assert.equal(continuesPreviousShot({transition:"continue"},{}),false);
});
test("shot plan validates language assignments and turns incompatible continuations into cuts", () => {
  const plan=()=>({productionBible:"Consistent daylight and wardrobe",clips:[structuredClone(shot)]});
  const opening=validateDirection(plan(),{});assert.equal(opening.clips[0].transition,"cut");
  assert.equal(validateDirection(plan(),{},[shot]).clips[0].transition,"continue");
  const changed=plan();changed.clips[0].cameraId="close-up";assert.equal(validateDirection(changed,{},[shot]).clips[0].transition,"cut");
  const bad=plan();bad.clips[0].dialogue=[{speaker:"Eli",language:"Japanese",text:"line",delivery:"calm"}];assert.throws(()=>validateDirection(bad,{}),/dialogue/);
  const text=plan();text.clips[0].renderedText=[{language:"Hebrew",text:"שלום",placement:"sign"}];assert.throws(()=>validateDirection(text,{}),/on-screen/);
  assert.ok(validateDirection(text,{textLanguages:["Hebrew"]}));
});
test("resolution changes generation payload and pricing; continuity and exact text reach the prompt", () => {
  const clip={...shot,startFrameSource:"previous-clip",assetIds:["eli"],dialogue:[{speaker:"Eli",language:"Spanish",text:"Buenos días",delivery:"calm"}],renderedText:[{language:"English",text:"OPEN",placement:"door"}]};
  const body=clipBody(clip,[{id:"eli",name:"Eli",description:"Blue coat, low gentle voice"}],{productionBible:"Warm daylight; fixed 35mm lens",dialogueLanguages:["Spanish"],textLanguages:["English"],resolution:"480p"});
  for(const value of ["Warm daylight","Blue coat","Buenos días","OPEN","actual final frame"])assert.ok(body.prompt.includes(value));
  assert.equal(body.resolution,"480p");assert.equal(body.duration,30);
  const price={type:"description",pricing_description:"24 fps / 1024 and $0.0214"};
  assert.ok(estimateUsd(price,body)<estimateUsd(price,{resolution:"720p",duration:30}));
  assert.throws(()=>estimateUsd(price,{resolution:"1080p",duration:30}));
});
