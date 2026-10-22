// Local-only integration: multipart R2 upload and approval/privacy boundaries; no AI calls.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
const base='http://localhost:5173',admin=process.argv.includes('--admin');
const login = await ownerLogin(),cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
let db;for(const n of readdirSync('.wrangler/state/v3/d1/miniflare-D1DatabaseObject').filter(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite')) {const d=new DatabaseSync('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/'+n);if(d.prepare("SELECT name FROM sqlite_master WHERE name='pro_videos'").get()){db=d;break;}d.close();}assert.ok(db);db.exec('PRAGMA busy_timeout=5000');
const ids=[];
async function post(action,data={},auth=cookie){const r=await fetch(base+'/api/pros',{method:'POST',headers:{'Content-Type':'application/json',Cookie:auth},body:JSON.stringify({action,...data})});return {status:r.status,body:await r.json()};}
async function media(id,auth=cookie,range){return fetch(base+'/api/pros/media?id='+id,{headers:{Cookie:auth,...(range?{Range:range}:{})}});}
const bytes=Buffer.alloc(8*1024*1024+32);bytes.write('ftyp',4);
const details={title:'Pros integration fixture',description:'Synthetic container for access checks',creator:'Test creator',category:'Short film',contentType:'video/mp4',bytes:bytes.length,duration:30,rights:true};
try {
  assert.equal((await post('list',{},'')).status,401);
  assert.equal((await post('list')).body.isAdmin,admin);
  assert.equal((await post('start',{...details,rights:false})).status,400);
  const started=await post('start',details);assert.equal(started.status,200,JSON.stringify(started));const id=started.body.id;ids.push(id);
  assert.equal((await post('finish',{id})).status,409);
  assert.equal((await media(id)).status,404);
  async function part(n,body){const r=await fetch(base+`/api/pros?id=${id}&part=${n}`,{method:'PUT',headers:{Cookie:cookie},body});return {status:r.status,body:await r.json()};}
  assert.equal((await part(1,Buffer.alloc(32))).status,400);
  assert.equal((await part(1,Buffer.alloc(8*1024*1024))).status,400);
  assert.equal((await part(1,bytes.subarray(0,8*1024*1024))).status,200);
  assert.equal((await part(1,bytes.subarray(0,8*1024*1024))).status,200,'retry same part is safe');
  assert.equal((await post('finish',{id})).status,409);
  assert.equal((await part(2,bytes.subarray(8*1024*1024))).status,200);
  assert.equal((await post('finish',{id})).status,200);
  assert.equal((await post('finish',{id})).status,200,'finish is idempotent');
  assert.equal((await post('list')).body.videos.some(v=>v.id===id),false);
  assert.equal((await post('list',{scope:'mine'})).body.videos.some(v=>v.id===id),true);
  const owned=await media(id,cookie,'bytes=0-15');assert.equal(owned.status,206);assert.equal((await owned.arrayBuffer()).byteLength,16);
  assert.equal((await part(2,bytes.subarray(8*1024*1024))).status,409,'submitted file is immutable');
  const owner=db.prepare('SELECT owner FROM pro_videos WHERE id=?').get(id).owner;
  db.prepare("UPDATE pro_videos SET owner='someone-else' WHERE id=?").run(id);
  if(admin){
    assert.equal((await media(id,cookie,'bytes=0-15')).status,206,'admin can preview pending upload');
    const queue=await post('list',{scope:'review'});assert.equal(queue.status,200);const v=queue.body.videos.find(v=>v.id===id);assert.ok(v);
    assert.equal((await post('review',{id,status:'approved',updated:0})).status,409);
    assert.equal((await post('review',{id,status:'approved',updated:v.updated,note:'Approved fixture'})).status,200);
    assert.equal((await post('list')).body.videos.some(v=>v.id===id),true);
    const current=(await post('list',{scope:'review'})).body.videos.find(v=>v.id===id);
    assert.equal((await post('review',{id,status:'rejected',updated:current.updated,note:'Remove fixture'})).status,200);
    assert.equal((await post('list')).body.videos.some(v=>v.id===id),false);
  }else{
    assert.equal((await media(id)).status,404,'non-owner cannot read unapproved media');
    assert.equal((await post('list',{scope:'review'})).status,403);
    assert.equal((await post('review',{id,status:'approved',updated:Date.now()})).status,403);
    assert.equal((await post('finish',{id})).status,404);
    db.prepare("UPDATE pro_videos SET status='approved' WHERE id=?").run(id);
    assert.equal((await post('list')).body.videos.some(v=>v.id===id),true);
    assert.equal((await media(id,cookie,'bytes=0-15')).status,206,'approved upload visible to signed-in viewers');
    db.prepare("UPDATE pro_videos SET status='rejected' WHERE id=?").run(id);
    assert.equal((await media(id)).status,404,'revocation blocks further media requests');
  }
  db.prepare('UPDATE pro_videos SET owner=? WHERE id=?').run(owner,id);
  const unfinished=await post('start',details);assert.equal(unfinished.status,200);ids.push(unfinished.body.id);
  assert.equal((await post('cancel',{id:unfinished.body.id})).status,200);
  assert.equal((await post('finish',{id:unfinished.body.id})).status,409);
  console.log('PASS '+(admin?'admin review, approval and revocation':'owner isolation, approved-only gallery and non-admin denial')+'; multipart validation, retry, completion, ranges and cancellation.');
}finally{for(const id of ids){db.prepare('DELETE FROM pro_video_parts WHERE video_id=?').run(id);db.prepare('DELETE FROM pro_videos WHERE id=?').run(id);}db.close();}
