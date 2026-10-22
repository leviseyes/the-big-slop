import { AppError, bucket, failure, getProject, identity, json } from '@/lib/server';
import { referenceDownloadManifest, referenceZipStream, safeDownloadName } from '@/services/reference-download.mjs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await identity();
    const url = new URL(req.url), id = url.searchParams.get('id') || '';
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new AppError('Invalid production.');
    const {project} = await getProject(id, user);
    let entries;
    try { entries = referenceDownloadManifest(project); }
    catch (e) { throw new AppError((e as Error).message, 409); }
    // Inherited references must also belong to the current production owner.
    for (const source of new Set<string>(entries.map((e:any) => e.key.split('/')[0])))
      if (source !== id) await getProject(source, user);
    const filename = `${safeDownloadName(project.title)} - references.zip`;
    if (url.searchParams.has('check')) return json({filename, count:entries.length});
    return new Response(referenceZipStream(entries, (key:string) => bucket().get(key)), {
      headers: {
        'Content-Type':'application/zip',
        'Content-Disposition':`attachment; filename="references.zip"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`,
        'Cache-Control':'private, no-store',
        'X-Content-Type-Options':'nosniff',
      },
    });
  } catch (e) { return failure(e); }
}
