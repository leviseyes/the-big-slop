// Every request is intercepted; this fixture never reaches a real provider.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
let images=0, uploads=[];
let p={id:'reference-fixture',style:'Cinematic',script:'An adult walks into a room.',status:'preparing',workflowVersion:2,targetMinutes:1,runtimeApprovedAt:Date.now(),planChunks:1,assets:[{id:'adult',name:'Adult',kind:'character',description:'Red coat',prompt:'Red coat',editInstructions:'Make the coat blue',editSourceKey:'reference-fixture/old.png',revision:1}],clips:[{id:'clip-1',prompt:'An adult walks into a room.',assetIds:['adult'],frameRevision:1},{id:'clip-2',prompt:'An empty room.',assetIds:[],frameKey:'reference-fixture/keep.png',frameUrl:'https://media.example/keep.png'}]};
const frame=await fs.readFile('frame.png');
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url);
 if(u.origin==='http://worker.test'){
  if(options.method==='PUT'){uploads.push(u.searchParams.get('key'));return Response.json({ok:true});}
  if(!options.method || options.method==='GET')return new Response(frame);
  const b=JSON.parse(options.body);
  if(b.action==='claim')return Response.json({job:{id:'job',lease:'lease',kind:'prepare'},project:p});
  if(b.action==='checkpoint'||b.action==='finish'){
   p=structuredClone(b.project);
   if(b.action==='finish'){await fs.writeFile('result.json',JSON.stringify({project:p,images,uploads}));process.emit('SIGTERM');}
   return Response.json({ok:true});
  }
  if(b.action==='heartbeat')return Response.json({ok:true});
 }
 if(u.href==='https://api.openai.com/v1/responses'){const b=JSON.parse(options.body);assert.equal(b.text.format.name,'edit_references');return Response.json({id:'resp_edit',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({referenceIds:[]})}]}]});}
 if(u.href==='https://api.openai.com/v1/images/edits'){
  images++;assert.equal(options.body.get('model'),'gpt-image-2.5-sunburst');assert.equal(options.body.get('size'),'1024x1024');
  assert.match(options.body.get('prompt'),/Make the coat blue/);
  const ref=options.body.get('image[]');assert.ok(ref);assert.deepEqual(Buffer.from(await ref.arrayBuffer()),frame);
  assert.equal(ref.name,images===1?'adult-edit-source-1.png':'adult.png');
  return Response.json({data:[{b64_json:frame.toString('base64')}]});
 }
 if(u.origin==='https://api.higgsfield.ai'){
  if(u.pathname.startsWith('/estimate/'))return Response.json({usd:1});
  if(u.pathname==='/files/generate-upload-url')return Response.json({upload_url:'https://media.example/upload',public_url:'https://media.example/updated.png'});
 }
 if(u.href==='https://media.example/upload' && options.method==='PUT')return new Response(null,{status:200});
 throw new Error(`Unexpected network request: ${u.href}`);
};
