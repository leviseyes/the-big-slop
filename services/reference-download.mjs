import { Zip, ZipPassThrough } from 'fflate';

export function safeDownloadName(value, fallback = 'production') {
  return String(value || '').normalize('NFKC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').replace(/^\.+|[. ]+$/g, '').slice(0, 100).trim() || fallback;
}

export function referenceDownloadManifest(project) {
  if (!project.assets?.length || project.assets.some(a => !a.imageKey))
    throw new Error('Your reference images are still being prepared. Download will be available when every image is ready.');
  const folders = {character:'Characters', location:'Locations', object:'Objects'};
  return project.assets.map((asset, index) => {
    const key = asset.imageKey;
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_./-]+\.(png|jpe?g|webp|gif|avif)$/i.test(key) || key.includes('..'))
      throw new Error('A reference image has an invalid storage path.');
    const extension = key.split('.').pop().toLowerCase();
    return {key, name:`${folders[asset.kind] || 'Other'}/${String(index + 1).padStart(3, '0')} - ${safeDownloadName(asset.name, 'Reference')}.${extension}`};
  });
}

// Original images are already compressed. Stream one storage chunk at a time.
export function referenceZipStream(entries, open) {
  async function* generate() {
    let failure, reader, archiveSize = 0;
    const pending = [];
    const zip = new Zip((error, data) => { if (error) failure = error; else pending.push(data); });
    const drain = function* () {
      if (failure) throw failure;
      while (pending.length) {
        const data = pending.shift();
        archiveSize += data.byteLength;
        if (archiveSize >= 0xffffffff) throw new Error('Reference ZIP exceeds the supported archive size.');
        yield data;
      }
    };
    try {
      if (entries.length > 65534) throw new Error('Too many reference images for one ZIP.');
      for (const entry of entries) {
        const object = await open(entry.key);
        if (!object?.body) throw new Error(`Reference image unavailable: ${entry.name}`);
        if (object.size >= 0xffffffff || archiveSize + object.size + 1024 >= 0xffffffff) throw new Error('Reference ZIP exceeds the supported archive size.');
        const file = new ZipPassThrough(entry.name);
        zip.add(file);
        reader = object.body.getReader();
        yield* drain();
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          file.push(value, false);
          yield* drain();
        }
        reader.releaseLock(); reader = undefined;
        file.push(new Uint8Array(), true);
        yield* drain();
      }
      zip.end();
      yield* drain();
    } finally {
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      zip.terminate();
    }
  }
  const iterator = generate();
  return new ReadableStream({
    async pull(controller) {
      try { const {done, value} = await iterator.next(); if (done) controller.close(); else controller.enqueue(value); }
      catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return(); },
  });
}
