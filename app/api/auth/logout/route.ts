import { sessionCookie } from '@/services/session.mjs';
export async function POST(request:Request) {
 const url=new URL(request.url);
 if(request.headers.get('origin')!==url.origin) return new Response('Cross-origin request rejected.',{status:403});
 return new Response(null,{status:303,headers:{Location:'/login','Cache-Control':'no-store','Set-Cookie':sessionCookie('',url.protocol==='https:',true)}});
}
