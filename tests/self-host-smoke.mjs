import assert from 'node:assert/strict';
import {base,login} from './self-host-login.mjs';
const page=await fetch(base+'/',{redirect:'manual'});assert.equal(page.status,307);assert.ok(page.headers.get('location').startsWith('/login'));
const csrf=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/x-www-form-urlencoded'},body:'password=wrong'});assert.equal(csrf.status,403);
const noOrigin=await fetch(base+'/api/auth/login',{method:'POST',body:'password=wrong'});assert.equal(noOrigin.status,403);
const forged=await fetch(base+'/api/studio',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'studio-owner','oai-authenticated-user-email':'owner@studio.local'},body:JSON.stringify({action:'list'})});assert.equal(forged.status,401);
const signed=await login(),cookie=signed.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');assert.match(signed.headers.get('set-cookie'),/HttpOnly/);
const studio=await fetch(base+'/',{headers:{Cookie:cookie}});assert.equal(studio.status,200);assert.match(await studio.text(),/Your AI|production|script/i);
const list=await fetch(base+'/api/studio',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{"action":"list"}'});assert.equal(list.status,200);const data=await list.json();assert.equal(data.ready.paymentsEnabled,false);assert.ok(!JSON.stringify(data).includes('SESSION_SECRET'));
const tampered=await fetch(base+'/api/studio',{method:'POST',headers:{Cookie:'big_slop_session=1','Content-Type':'application/json'},body:'{"action":"list"}'});assert.equal(tampered.status,401);
for(const path of ['/api/media?key=private.png','/api/references/download?id=private']){const r=await fetch(base+path);assert.equal(r.status,401);}
const logout=await fetch(base+'/api/auth/logout',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:base}});assert.equal(logout.status,303);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
console.log('PASS: real sign-in, protected studio/media, forged identity rejection, CSRF, signed cookies, logout and disabled payments.');
