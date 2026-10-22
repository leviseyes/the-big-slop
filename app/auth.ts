import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { configured, readSession, validSession, safeReturn } from '@/services/session.mjs';
export async function getStudioUser() {
  const config = env as unknown as Record<string,string>;
  if(!configured(config) || !await validSession(readSession((await headers()).get('cookie')),config.SESSION_SECRET)) return null;
  const email = config.ADMIN_EMAIL || 'owner@studio.local';
  return {userId:'studio-owner',email,displayName:'Studio owner',fullName:'Studio owner'};
}
export async function requireStudioUser(returnTo:string) {
  const user = await getStudioUser();
  if(user) return user;
  redirect(`/login?return_to=${encodeURIComponent(safeReturn(returnTo))}`);
}
