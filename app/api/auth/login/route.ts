import { env } from 'cloudflare:workers';
import { configured, verifyPassword, issueSession, safeReturn, sessionCookie } from '@/services/session.mjs';
export async function POST(request:Request) {
 const config=env as unknown as Record<string,any>, url=new URL(request.url);
 if(request.headers.get('origin')!==url.origin || request.headers.get('sec-fetch-site')==='cross-site') return new Response('Cross-origin sign-in rejected.',{status:403});
 if(!configured(config)||!config.DB) return new Response('Run setup before signing in.',{status:503});
 if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded') || Number(request.headers.get('content-length'))>4096) return new Response('Invalid sign-in request.',{status:400});
 const raw=await request.text();if(raw.length>4096) return new Response('Request too large.',{status:413});
 const form=new URLSearchParams(raw), target=safeReturn(form.get('return_to'));
 const fail=(error:string)=>new Response(null,{status:303,headers:{Location:`/login?error=${error}&return_to=${encodeURIComponent(target)}`,'Cache-Control':'no-store'}});
 // An atomic, instance-wide limit prevents bypass through forged IP headers.
 const window=Math.floor(Date.now()/300000);
 const row=await config.DB.prepare('INSERT INTO auth_attempts (window, attempts) VALUES (?, 1) ON CONFLICT(window) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(window).first();
 if(row.attempts>10) return fail('limited');
 await config.DB.prepare('DELETE FROM auth_attempts WHERE window < ?').bind(window-1).run();
 if(!await verifyPassword(form.get('password'),config.STUDIO_PASSWORD_HASH)) return fail('invalid');
 return new Response(null,{status:303,headers:{Location:target,'Cache-Control':'no-store','Set-Cookie':sessionCookie(await issueSession(config.SESSION_SECRET),url.protocol==='https:')}});
}
