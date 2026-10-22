import { imageCatalog } from './image-edit-context.mjs';
export const LEGACY_REFERENCE_STOP = 'Reference-based image replacement was rejected. Production paused for review; identity references will not be silently discarded.';
export const SAFE_CONTENT_DIRECTION = 'Depict only nonsexual, non-graphic action. Replace prohibited visual content with appropriate clothing, an off-screen event, a neutral reaction or a harmless prop while preserving the established cast and setting. Never disguise prohibited content or bypass provider rules.';
export const SAFE_WARDROBE = 'The character wears a modest opaque navy two-piece swimsuit with a secure full-coverage top and high-waisted full-coverage bottoms wherever the original visual direction calls for nudity. No nudity, exposure, transparent fabric, erotic posing or sexual action. Preserve the character’s established face, hair, age and build; retain other existing clothing in scenes that already have it. If swimwear is unsuitable, use a fully clothed neutral reaction shot.';
export const SAFE_WARDROBE_REFERENCE = 'Edit the supplied The character identity reference to show the same adult woman in a modest opaque navy two-piece swimsuit, secure full-coverage top and high-waisted full-coverage bottoms, neutral standing pose. Preserve her face, hair, age, glasses and build. Replace the cardigans and dress with the swimsuit for this wardrobe variant. No nudity, transparent fabric, erotic posing, sexual action or text.';
export function needsSwimwear(clip) {
  return /\b(naked|nude|nudity|unclothed|undress\w*|disrob\w*|topless|bare[- ]breast\w*|bare[- ]bod\w*|exposed breasts|exposed genitals)\b/i.test([clip.prompt,clip.openingState,clip.closingState,clip.actionBeats,...(clip.storyboard||[]).flatMap(s=>[s.composition,s.action])].join(' '));
}
export function pendingImageDiagnostics(p) {
  return p.clips.flatMap(c => (c.storyboard || []).map((s,i) => ({clipId:c.id,shotIndex:i,composition:s.composition,action:s.action,stored:!!s.imageKey,connected:!!s.referenceUrl,recovery:s.recovery?.storyboard}))).filter(s=>!s.connected).slice(0,1);
}
export function adoptAcceptedWardrobe(p, asset) {
  if (!asset.identityAssetId || !asset.imageKey || asset.recovery?.reference?.attempts?.at(-1)?.status !== 'complete') return false;
  p.requestedSafetyDirection ??= p.safetyDirection;
  asset.name = asset.name.replace('swimsuit wardrobe', 'safe wardrobe');
  p.safetyDirection = `For The character scenes originally calling for nudity, use the accepted ${asset.name} image as the wardrobe authority. Follow the clothing actually shown in that image, including a fully clothed fallback if chosen, rather than the originally requested swimsuit. Preserve her established face, hair, age and build. Retain the original clothed reference for other scenes. Keep all action nonsexual and non-graphic.`;
  p.safetyWardrobeNote = asset.recovery.reference.summary || 'Safe wardrobe reference created. Review the actual clothing before continuing.';
  return true;
}
export function authorizeSafeWardrobeRecovery(p, assetId, now=Date.now()) {
  if(p.status!=='failed' || p.error!==LEGACY_REFERENCE_STOP || p.workStage!=='storyboards' || p.generationAuthorization || p.paidAt || p.checkoutId || !p.runtimeApprovedAt || p.safeWardrobeRecoveryAt)
    throw new Error('This production is not eligible for the requested wardrobe recovery.');
  const pending=pendingImageDiagnostics(p)[0], c=p.clips.find(c=>c.id===pending?.clipId), shot=c?.storyboard[pending.shotIndex];
  const state=shot?.recovery?.storyboard, last=state?.attempts?.at(-1), rejected=state?.attempts?.at(-2);
  const asset=p.assets.find(a=>a.id===assetId && a.kind==='character');
  if(!asset?.imageKey || !state?.textOnly || state.rewriting || state.revisionError || last?.status!=='submitting' || last.requestId || rejected?.status!=='rejected' || !rejected.policy || !rejected.repaired || shot.imageKey)
    throw new Error('Saved image state does not match the known local reference guard. No request was retried.');
  const wardrobeId=`${asset.id}-safe-swimwear`;
  if(p.assets.some(a=>a.id===wardrobeId) || p.assets.length>=500) throw new Error('Wardrobe reference already exists or reference limit reached.');
  const affected=p.clips.filter(c=>c.assetIds.includes(assetId) && needsSwimwear(c));
  // This is a wardrobe variant, not a new character. Retain the original image
  // for clothed scenes; substitute only the attachment used by nude scenes.
  // This exact legacy guard ran before any network call. Retain the audit entry;
  // do not apply this exception to provider timeouts or unknown submissions.
  last.status='rejected';last.transient=true;last.repaired=true;last.localPreflightOnly=true;last.error=LEGACY_REFERENCE_STOP;
  state.previousStartedAt=state.startedAt;state.startedAt=now;
  p.editReferenceLibrary=imageCatalog(p);
  p.assets.push({id:wardrobeId,name:`${asset.name} — swimsuit wardrobe`,kind:'character',description:`Same identity as ${asset.name}; modest opaque navy two-piece swimsuit wardrobe.`,prompt:SAFE_WARDROBE_REFERENCE,editSourceKey:asset.imageKey,editInstructions:SAFE_WARDROBE_REFERENCE,editReferenceIds:[],editPlan:{referenceIds:[]},revision:1,status:'planned',identityAssetId:assetId});
  p.safetyDirection=SAFE_WARDROBE;p.safetyDirectionRevision=now;p.safeWardrobeRecoveryAt=now;
  for(const clip of affected) {
    clip.assetIds=clip.assetIds.map(id=>id===assetId?wardrobeId:id);
    clip.previousStoryboardVersions ??= [];clip.previousStoryboardVersions.push({at:now,storyboard:structuredClone(clip.storyboard),frameKey:clip.frameKey,frameUrl:clip.frameUrl});
    clip.frameRevision=(clip.frameRevision||0)+1;
    for(const key of ['frameKey','frameUrl','plannedFrameUrl','input']) delete clip[key];
    if(clip.recovery) delete clip.recovery.frame;
    for(const panel of clip.storyboard||[]) for(const key of ['imageKey','referenceUrl','recovery','approvedImageKey','continuityChecks']) delete panel[key];
    clip.needsSafeDirection=true;
  }
  delete p.referencesApprovedAt;delete p.storyboardsApprovedAt;delete p.quote;delete p.error;delete p.progress;
  p.status='preparing';p.workStage='references';p.phase='Creating the character’s swimsuit wardrobe reference. Review it before continuing to storyboards.';
  p.recoveryEvents ??= [];p.recoveryEvents.push({at:now,itemId:wardrobeId,kind:'wardrobe',message:'Requested safe adaptation: The character wears a modest two-piece swimsuit instead of nudity. Affected storyboards will be rebuilt after reference review. Original images are retained.'});
  return wardrobeId;
}
