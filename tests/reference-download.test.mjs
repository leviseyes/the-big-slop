import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {referenceDownloadManifest,referenceZipStream,safeDownloadName} from '../services/reference-download.mjs';

test('archive contains current production references only, with unique safe categorized names',()=>{
 const p={assets:[{name:'Mara / portrait',kind:'character',imageKey:'production/assets/mara-v2.png',editSourceKey:'production/assets/mara-v1.png'},{name:'Mara / portrait',kind:'character',imageKey:'production/assets/mara-copy.jpg'},{name:'Kitchen',kind:'location',imageKey:'series-source/assets/kitchen.webp'},{name:'Badge',kind:'object',imageKey:'production/assets/badge.png'}],clips:[{frameKey:'production/frames/1.png'}]};
 const entries=referenceDownloadManifest(p);
 assert.equal(entries.length,4);assert.equal(new Set(entries.map(e=>e.name)).size,4);
 assert.equal(entries[0].name,'Characters/001 - Mara - portrait.png');
 assert.match(entries[2].name,/^Locations\//);assert.match(entries[3].name,/^Objects\//);
 assert.ok(!JSON.stringify(entries).includes('v1.png'));
 for(const assets of [[],[{imageKey:undefined}],[{imageKey:'p/../secret.png'}],[{imageKey:'https://remote/image.png'}]])assert.throws(()=>referenceDownloadManifest({assets}));
 assert.equal(safeDownloadName('...'),'production');assert.ok(!safeDownloadName('a\r\nb').includes('\n'));
});

test('hundreds of streamed originals unzip intact, including Unicode filenames',async()=>{
 const entries=Array.from({length:322},(_,i)=>({key:String(i),name:`Characters/${i} - שלום.png`}));
 const originals=new Map(entries.map((e,i)=>[e.key,Uint8Array.from({length:1027},(_,n)=>(i+n)%256)]));
 let active=0,maxActive=0;
 const stream=referenceZipStream(entries,async key=>{
   active++;maxActive=Math.max(maxActive,active);const bytes=originals.get(key);let offset=0;
   return {size:bytes.length,body:new ReadableStream({pull(c){if(offset===bytes.length){active--;c.close();return;}const end=Math.min(offset+127,bytes.length);c.enqueue(bytes.slice(offset,end));offset=end;}})};
 });
 const zip=new Uint8Array(await new Response(stream).arrayBuffer());
 const decoded=unzipSync(zip);assert.equal(Object.keys(decoded).length,322);assert.equal(maxActive,1);
 for(const e of entries)assert.deepEqual(decoded[e.name],originals.get(e.key));
});

test('cancel stops storage reads and a missing image fails instead of a partial success',async()=>{
 let opened=0,canceled=false;
 const stream=referenceZipStream([{key:'1',name:'1.png'},{key:'2',name:'2.png'}],async()=>{opened++;return {size:100,body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(10));},cancel(){canceled=true;}})};});
 const reader=stream.getReader();await reader.read();await reader.cancel();
 assert.equal(opened,1);assert.equal(canceled,true);
 await assert.rejects(new Response(referenceZipStream([{key:'missing',name:'missing.png'}],async()=>null)).arrayBuffer(),/unavailable/);
});
