"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
export default function StoryboardReview({ project, onChange }: { project:any; onChange:(p:any)=>void }) {
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [editing,setEditing]=useState<string|null>(null), [composition,setComposition]=useState(''), [action,setAction]=useState('');
  const clips=project.clips;
  const shots=clips.flatMap((c:any)=>c.storyboard||[]);
  if(!shots.length)return null;
  const editable=['storyboards_ready','ready'].includes(project.status) && !project.paidAt && !project.generationAuthorization && !project.checkoutId;
  const accepted=shots.filter((s:any)=>s.imageKey && s.approvedImageKey===s.imageKey).length;
  const allReady=clips.every((c:any)=>c.storyboard?.length && c.storyboard.every((s:any)=>s.imageKey && s.referenceUrl));
  const request=async(payload:any)=>{setBusy(true);setError('');try {const response=await fetch('/api/studio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:project.id,...payload})});const result:any=await response.json();if(!response.ok)throw new Error(result.error||'Could not save storyboard review.');setEditing(null);onChange(result.project);}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}};
  return <section className="storyboard-review" aria-label="Full production storyboard">
    <span className="eyebrow">STORYBOARD REVIEW · REQUIRED BEFORE PRODUCTION</span>
    <h3>Read your film, shot by shot.</h3>
    <p>Sequential 16:9 panels show framing, blocking and movement. Camera, action and audio directions belong to each shot. {editable ? `${accepted} of ${shots.length} panels accepted. Review and change individual shots, or accept all shots at once when you’re happy with the storyboard.` : 'Your illustrated shooting plan, from opening shot to final frame.'}</p>
    {editable && <div className="storyboard-approval">
      <p role="status">{accepted} / {shots.length} shots accepted. Accepting all approves their current images. You can still change a shot before continuing.</p>
      <Button disabled={busy || editing!==null || !allReady || accepted===shots.length} onClick={()=>request({action:'acceptAllStoryboards',shots:clips.flatMap((c:any)=>(c.storyboard||[]).map((s:any,shotIndex:number)=>({clipId:c.id,shotIndex,imageKey:s.imageKey})))})}>{busy?'Saving…':accepted===shots.length?'✓ All shots accepted':`Accept all ${shots.length} shots`}</Button>
      {editing!==null && <small>Save or cancel your open shot edit before accepting all shots.</small>}
      {accepted===shots.length ? <Button disabled={busy || editing!==null} onClick={()=>request({action:'approveStoryboards',accepted:true})}>All storyboards reviewed — continue</Button> : <small>Accepting shots does not start video generation. You’ll continue to the next step separately.</small>}
    </div>}
    {clips.map((c:any,i:number)=><details key={c.id} open={editable || clips.length===1}>
      <summary>Sequence {i+1} · {i*30}–{(i+1)*30}s · {c.storyboard?.length||0} shots</summary>
      <div className="storyboard-panels">{c.storyboard?.map((s:any,j:number)=>{
        const key=`${c.id}:${j}`,approved=s.imageKey && s.approvedImageKey===s.imageKey;
        return <figure key={key}>
          <div className="board-panel-heading"><b>{String(i+1).padStart(2,'0')}.{String(j+1).padStart(2,'0')}</b><span>{i*30+s.start}–{i*30+s.end}s · {s.end-s.start}s</span></div>
          {s.imageKey?<a href={`/api/media?key=${encodeURIComponent(s.imageKey)}`} target="_blank" rel="noreferrer" aria-label={`Open sequence ${i+1} shot ${j+1}`}><img loading="lazy" src={`/api/media?key=${encodeURIComponent(s.imageKey)}`} alt={`Storyboard shot ${j+1}: ${s.composition}`}/></a>:<div className="storyboard-placeholder">Drawing shot {j+1}…</div>}
          <figcaption>
            <p><b>Camera & framing</b><br/>{s.composition}</p><p><b>Action & movement</b><br/>{s.action}</p><p><b>Dialogue & sound</b><br/>{s.audio}</p>
            {editable && (editing===key?<div className="board-editor">
              <label>Camera & framing<Textarea value={composition} onChange={e=>setComposition(e.target.value)} maxLength={3000}/></label>
              <label>Action & movement<Textarea value={action} onChange={e=>setAction(e.target.value)} maxLength={3000}/></label>
              <small>Redraws this panel using your cast and set references. Uses OpenAI credits; allow about 1–4 minutes plus queue time. Review the new panel before accepting it.</small>
              <Button disabled={busy || composition.trim().length<3 || action.trim().length<3} onClick={()=>request({action:'reviseStoryboard',clipId:c.id,shotIndex:j,imageKey:s.imageKey,composition,direction:action})}>Save & redraw this shot</Button>
              <Button variant="outline" disabled={busy} onClick={()=>setEditing(null)}>Cancel</Button>
            </div>:<div className="board-review-actions">
              <Button disabled={busy || approved || !s.referenceUrl} onClick={()=>request({action:'acceptStoryboard',clipId:c.id,shotIndex:j,imageKey:s.imageKey})}>{approved?'✓ Accepted':'Accept this shot'}</Button>
              <Button variant="outline" disabled={busy} onClick={()=>{setEditing(key);setComposition(s.composition);setAction(s.action);}}>Change shot</Button>
            </div>)}
          </figcaption>
        </figure>;
      })}</div>
    </details>)}
    {error && <p role="alert">{error}</p>}
    {editable && <div className="storyboard-approval"><p>{accepted} / {shots.length} accepted. Changed panels must be accepted again.</p><Button disabled={busy || editing!==null || accepted!==shots.length} onClick={()=>request({action:'approveStoryboards',accepted:true})}>{busy?'Saving…':'All storyboards reviewed — continue'}</Button></div>}
  </section>;
}
