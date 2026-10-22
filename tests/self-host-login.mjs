import {readFileSync} from 'node:fs';
export const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
export async function login() {
 const password=process.env.TEST_STUDIO_PASSWORD||readFileSync('.studio-password','utf8').trim();
 const response=await fetch(base+'/api/auth/login',{method:'POST',redirect:'manual',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password,return_to:'/'}).toString()});
 if(response.status!==303 || response.headers.get('location')!=='/') throw Error(`Self-host sign-in failed (HTTP ${response.status}, redirect ${response.headers.get('location') || 'none'}); check setup and test rate limit.`);
 return response;
}
