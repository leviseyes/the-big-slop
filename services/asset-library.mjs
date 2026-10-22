export const ASSET_GROUPS=['Characters','Locations','Props','Storyboards','Scene frames','Continuity frames','Saved versions'];
export function assetLibraryCatalog(p) {
 const items=[], seen=new Set();
 const add=(key,name,group,description='',source='Generated',sequence)=>{if(!key||seen.has(key))return;seen.add(key);items.push({key,name,group,description,source,sequence});};
 for(const a of p.assets||[]) {
  const group=a.kind==='character'?'Characters':a.kind==='location'?'Locations':'Props';
  add(a.imageKey,a.name,group,a.description,a.source==='upload'?'Uploaded':'Generated');
  add(a.editSourceKey,`${a.name} — previous version`,'Saved versions',a.description,a.source==='upload'?'Uploaded':'Generated');
 }
 for(const [i,c] of (p.clips||[]).entries()) {
  for(const [j,s] of (c.storyboard||[]).entries()) add(s.imageKey,`Sequence ${i+1} · Shot ${j+1}`,'Storyboards',[`${i*30+s.start}–${i*30+s.end}s`,s.composition,s.action,s.audio].filter(Boolean).join('\n'),'Generated',i+1);
  add(c.frameKey,`Sequence ${i+1} · Opening frame`,'Scene frames',c.openingState,'Generated',i+1);
  add(c.lastFrameKey,`Sequence ${i+1} · Closing frame`,'Continuity frames',c.closingState,'Extracted',i+1);
  for(const [n,r] of Object.entries(c.replacements||{})) add(r.imageKey,`Sequence ${i+1} · Replacement ${n}`,'Scene frames','','Generated',i+1);
 }
 for(const a of p.editReferenceLibrary||[]) add(a.imageKey,`${a.name} — saved reference`,'Saved versions',a.description);
 return items;
}
