// Snapshot the whole image library before a batch invalidates any of its images.
export function imageCatalog(project) {
  const refs = [], seen = new Set();
  const add = (r) => { if (r.imageKey && !seen.has(r.imageKey)) { seen.add(r.imageKey); refs.push(r); } };
  for (const a of project.assets || []) add({id:`asset:${a.id}`,name:a.name,kind:a.kind,description:a.description || '',imageKey:a.imageKey || a.editSourceKey});
  for (const [i,c] of (project.clips || []).entries()) {
    add({id:`frame:${c.id}`,name:`Clip ${i+1} opening frame`,kind:'scene frame',description:c.prompt || '',imageKey:c.frameKey});
    for(const [j,s] of (c.storyboard || []).entries()) add({id:`board:${c.id}:${j}`,name:`Clip ${i+1}, storyboard ${j+1}`,kind:'storyboard',description:[s.composition,s.action].filter(Boolean).join('. '),imageKey:s.imageKey});
  }
  return refs;
}
export function editAttachments(asset,catalog,selected=[]) {
  const ids=[...new Set([...(asset.editReferenceIds || []),...selected])];
  if(ids.length>15) throw new Error('An image edit can use up to 15 supporting images.');
  const refs=[{id:`${asset.id}-edit-source-${asset.revision}`,name:asset.name,kind:'EDIT TARGET',description:asset.description,imageKey:asset.editSourceKey}];
  if(!refs[0].imageKey) throw new Error('The original image for this edit is missing.');
  for(const id of ids) {
    const ref=catalog.find(r=>r.id===id);
    if(!ref || ref.imageKey===asset.editSourceKey) throw new Error('An edit reference is unavailable or is the target itself.');
    refs.push({...ref,id:`edit-ref-${refs.length}`});
  }
  return refs;
}
export function imageEditPrompt(project,asset,refs) {
  return [
    `${project.style} style. Edit IMAGE 1 only. Return one finished production reference at 1024x1024.`,
    'REFERENCE LOCK — attachment numbers below match the actual uploaded files in order.',
    ...refs.map((r,i)=>`IMAGE ${i+1} — ${r.name} (${r.kind}): ${String(r.description || '').slice(0,1200)}`),
    `REQUESTED CHANGE: ${asset.editInstructions}`,
    'Supporting images are authorities for the named characters, objects, faces, clothing, logos, layouts and established details. Copy the requested detail from the correct reference; do not invent a substitute character or mix identities. Preserve all unrelated details and the composition of IMAGE 1. Do not reproduce reference sheets, panels, extra people or a collage.',
    'For a badge or lanyard: place the referenced character’s likeness inside the existing photo area, matching its perspective, material and lighting. Preserve the lanyard, holder and scale. Use only information explicitly supplied in the request or reference descriptions, or clearly legible in the reference image. Never invent personal details or ID numbers. If information is missing, leave that field blank.',
    'Render text explicitly requested by this edit exactly as provided. This explicit request takes precedence over general no-label or no-text preferences for this reference image. Do not add unrelated captions, labels, watermarks or lettering.',
  ].join('\n');
}
