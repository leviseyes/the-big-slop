export function boardsApproved(p) {
  return p.clips.length > 0 && p.clips.every(c => c.storyboard?.length && c.storyboard.every(s => s.imageKey && s.referenceUrl && s.approvedImageKey === s.imageKey));
}
export function reviewStoryboard(p, input) {
  if (p.paidAt || p.generationAuthorization || p.checkoutId || !['storyboards_ready','ready'].includes(p.status)) throw new Error('Storyboard editing is available after drawing finishes and before committing production.');
  const next=structuredClone(p);
  if(input.action==='acceptAllStoryboards') {
    const current=next.clips.flatMap(c=>(c.storyboard||[]).map((s,shotIndex)=>({clipId:c.id,shotIndex,imageKey:s.imageKey})));
    if(!current.length || next.clips.some(c=>!c.storyboard?.length || c.storyboard.some(s=>!s.imageKey || !s.referenceUrl))) throw new Error('Wait until every storyboard shot is ready before accepting all shots.');
    if(!Array.isArray(input.shots) || input.shots.length!==current.length || current.some((s,i)=> {
      const submitted=input.shots[i];
      return !submitted || submitted.clipId!==s.clipId || submitted.shotIndex!==s.shotIndex || submitted.imageKey!==s.imageKey;
    })) throw new Error('The storyboards changed. Reload and review the current versions before accepting all shots.');
    for(const c of next.clips) for(const s of c.storyboard) s.approvedImageKey=s.imageKey;
    return next;
  }
  const clip=next.clips.find(c=>c.id===input.clipId), shot=clip?.storyboard?.[input.shotIndex];
  if (!shot || !Number.isInteger(input.shotIndex) || !shot.imageKey || input.imageKey!==shot.imageKey) throw new Error('This panel changed. Reload and review the current version.');
  if(input.action==='acceptStoryboard') { shot.approvedImageKey=shot.imageKey; return next; }
  for(const field of ['composition','direction']) if(typeof input[field]!=='string' || input[field].trim().length<3 || input[field].length>3000) throw new Error('Add camera and action directions (3–3,000 characters each).');
  shot.composition=input.composition.trim(); shot.action=input.direction.trim(); shot.revision=(shot.revision||0)+1;
  delete shot.imageKey; delete shot.referenceUrl; delete shot.recovery; delete shot.approvedImageKey;
  delete clip.frameKey; delete clip.frameUrl; delete clip.plannedFrameUrl; delete clip.input;
  delete next.storyboardsApprovedAt; delete next.quote;
  next.status='preparing'; next.workStage='storyboards'; next.phase='Redrawing your revised storyboard panel. Review it again before continuing.';
  return next;
}
