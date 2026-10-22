const bytes = text => new TextEncoder().encode(text).length;
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

// Archive only completed, stored image generations. Pending requests, identities,
// shot prompts and approvals remain live. A failed archive never discards history.
export async function compactImageHistory(project, write) {
  const candidates=[];
  const collect=(item,kind,imageKey,path)=>{
    const state=item.recovery?.[kind];
    if(!imageKey?.startsWith(`${project.id}/`) || !state || state.archivedKey || state.attempts?.at(-1)?.status!=='complete')return;
    candidates.push({item,kind,path,state});
  };
  for(const a of project.assets||[])collect(a,'reference',a.imageKey,['asset',a.id]);
  for(const c of project.clips||[]){
    collect(c,'frame',c.frameKey,['clip',c.id]);
    for(const [i,s] of (c.storyboard||[]).entries())collect(s,'storyboard',s.imageKey,['shot',c.id,i]);
  }
  if(!candidates.length)return {archived:0};
  const before=bytes(JSON.stringify(project)),groups=[];
  let group=[],size=0;
  for(const c of candidates){const n=bytes(JSON.stringify(c.state));if(size+n>4*1024*1024 && group.length){groups.push(group);group=[];size=0;}group.push(c);size+=n;}
  if(group.length)groups.push(group);
  const replacements=[];
  for(const group of groups){
    const text=JSON.stringify({projectId:project.id,entries:group.map(c=>({path:c.path,kind:c.kind,state:c.state}))});
    const key=`${project.id}/history/images-${await digest(text)}.json`;
    await write(key,text);
    group.forEach((c,index)=>replacements.push({...c,key,index}));
  }
  for(const c of replacements)c.item.recovery[c.kind]={
    archivedKey:c.key,archivedEntry:c.index,startedAt:c.state.startedAt,
    attempts:c.state.attempts,summary:c.state.summary,textOnly:c.state.textOnly,
  };
  return {archived:candidates.length,before,after:bytes(JSON.stringify(project))};
}

// The browser needs the script, plan, assets and progress, not the renderer's
// internal retry prompts or saved director request bookkeeping.
export function publicProduction(project) {
  const internal=new Set(['recovery','directorRequests','pendingPlan','workerSave','editReferenceLibrary']);
  return JSON.parse(JSON.stringify(project,(key,value)=>internal.has(key)?undefined:value));
}
