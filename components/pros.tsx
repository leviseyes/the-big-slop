"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Play, Film, Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CATEGORIES } from "@/services/production-categories.mjs";
type Video={id:string;title:string;description:string;creator:string;category:string;status:string;duration:number;reviewNote?:string;updated:number};
async function api(action:string,data:any={}) {
  const response=await fetch("/api/pros",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(120000)});
  const result:any=await response.json(); if(!response.ok) throw new Error(result.error || "Could not save your video. Please retry."); return result;
}
function duration(seconds:number) {return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;}
export function Pros({category,query}:{category:string;query:string}) {
  const [scope,setScope]=useState("gallery"),[admin,setAdmin]=useState(false),[items,setItems]=useState<Video[]>([]),[page,setPage]=useState(0),[more,setMore]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const [open,setOpen]=useState(false),[playing,setPlaying]=useState<Video|null>(null),[playError,setPlayError]=useState(false),[notes,setNotes]=useState<Record<string,string>>({});
  const [file,setFile]=useState<File|null>(null),[title,setTitle]=useState(""),[description,setDescription]=useState(""),[creator,setCreator]=useState(""),[format,setFormat]=useState("Short film"),[rights,setRights]=useState(false),[progress,setProgress]=useState(0),[uploading,setUploading]=useState(false),[uploadError,setUploadError]=useState("");
  const session=useRef<{id:string;partBytes:number;next:number}|null>(null),cancelled=useRef(false),loadSequence=useRef(0);
  async function load(target=scope,p=page) {const seq=++loadSequence.current;setLoading(true);setError("");try{const r=await api("list",{scope:target,page:p,category,query});if(seq===loadSequence.current){setItems(r.videos);setAdmin(r.isAdmin);setMore(r.hasMore);}}catch(e){if(seq===loadSequence.current)setError((e as Error).message);}finally{if(seq===loadSequence.current)setLoading(false);}}
  useEffect(()=>{load();},[scope,page,category,query]);
  useEffect(()=>setPage(0),[category,query]);
  useEffect(()=>{if(!uploading)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[uploading]);
  function changeScope(s:string){setScope(s);setPage(0);}
  async function action(fn:()=>Promise<void>){setBusy(true);setError("");try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function upload(){
    if(!file)return; setUploading(true);setUploadError("");cancelled.current=false;
    try {
      if(!session.current){
        if(file.size>5*1024**3)throw new Error("Choose a video up to 5 GB.");
        const seconds=await new Promise<number>((resolve,reject)=>{const v=document.createElement("video"),url=URL.createObjectURL(file);const done=()=>{clearTimeout(timer);v.removeAttribute("src");v.load();URL.revokeObjectURL(url);};const timer=setTimeout(()=>{done();reject(new Error("Could not read this video. Export it as MP4 (H.264) or WebM."));},20000);v.preload="metadata";v.onloadedmetadata=()=>{const d=v.duration;done();Number.isFinite(d)&&d>0?resolve(d):reject(new Error("This video has no readable duration."));};v.onerror=()=>{done();reject(new Error("Your browser cannot play this file. Use MP4 (H.264) or WebM."));};v.src=url;});
        const r=await api("start",{title,description,creator,category:format,contentType:file.type || (file.name.toLowerCase().endsWith(".webm")?"video/webm":"video/mp4"),bytes:file.size,duration:seconds,rights});session.current={...r,next:0};
      }
      const s=session.current!;
      while(s.next<file.size){
        if(cancelled.current)throw new Error("Upload paused. Press Resume upload to continue.");
        const end=Math.min(s.next+s.partBytes,file.size);
        const response=await fetch(`/api/pros?id=${s.id}&part=${Math.floor(s.next/s.partBytes)+1}`,{method:"PUT",body:file.slice(s.next,end),signal:AbortSignal.timeout(180000)});
        if(!response.ok){const r:any=await response.json();throw new Error(r.error || "Upload interrupted. Press Resume upload to continue.");}
        s.next=end;setProgress(Math.round(end/file.size*100));
      }
      await api("finish",{id:s.id});session.current=null;setFile(null);setTitle("");setDescription("");setRights(false);setOpen(false);setNotice("Submitted for admin review. Your video will appear in The Pros only after approval.");changeScope("mine");await load("mine",0);
    }catch(e){setUploadError((e as Error).name==="TimeoutError"?"The connection timed out. Press Resume upload to retry the current part.":(e as Error).message);}finally{setUploading(false);}
  }
  const visible=items.filter(v=>(category==="All"||v.category===category)&&`${v.title} ${v.creator}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="pros-section">
    <div className="pros-toolbar"><div className="pros-views" aria-label="Uploaded video views">{[["gallery","Approved films"],["mine","My submissions"],...(admin?[["review","Admin review"]]:[])].map(([s,label])=><Button key={s} variant={s===scope?"default":"outline"} onClick={()=>changeScope(s)}>{s==="review"&&<ShieldCheck size={16}/>} {label}</Button>)}</div><div className="pros-views"><Button variant="ghost" aria-label="Refresh submissions" onClick={()=>load()} disabled={loading}><RefreshCw size={17}/></Button><Button onClick={()=>{setUploadError("");setOpen(true);}}><Upload size={17}/> Upload a video</Button></div></div>
    <p className="pros-intro">{scope==="gallery"?"User-uploaded films, selected by our admin. Every title here has been reviewed and approved.":scope==="mine"?"Track your uploads and read the admin’s feedback. Pending and rejected videos are visible only to you and the admin.":"Watch each submission before approving it. Approval adds it to The Pros; rejection removes it from the collection."}</p>
    {error&&<p role="alert" className="library-alert">{error} <button onClick={()=>load()}>Retry</button></p>}{notice&&<p role="status" className="library-notice">{notice}</p>}
    {loading?<div role="status" className="cinema-empty"><Loader2 className="spin"/> Loading videos…</div>:<>
    {visible.length?<div className="film-grid pros-grid">{visible.map(v=><article className="film-card pro-card" key={v.id}>
      <button className="film-poster pro-poster" disabled={["uploading","finalizing","cancelled"].includes(v.status)} onClick={()=>{setPlaying(v);setPlayError(false);}} aria-label={`Watch ${v.title}`}><div className="poster-fallback"><Film size={40}/><span>{v.category}</span></div>{["pending","approved","rejected"].includes(v.status)&&<span className="poster-play"><Play fill="currentColor"/></span>}<span className="runtime-tag">{duration(v.duration)}</span></button>
      <h3>{v.title}</h3><p className="pro-creator">By {v.creator}</p><p className="pro-description">{v.description}</p>
      {scope!=="gallery"&&<><span className={`pro-status pro-${v.status}`}>{v.status==="pending"?"Awaiting admin approval":v.status==="finalizing"?"Finishing upload":v.status}</span>{v.reviewNote&&<p className="pro-feedback"><strong>Admin feedback:</strong> {v.reviewNote}</p>}</>}
      {scope==="mine"&&v.status==="uploading"&&<Button variant="outline" disabled={busy} onClick={()=>action(async()=>{await api("cancel",{id:v.id});})}>Cancel unfinished upload</Button>}
      {scope==="mine"&&v.status==="finalizing"&&<Button disabled={busy} onClick={()=>action(async()=>{await api("finish",{id:v.id});})}>Finish submission</Button>}
      {scope==="review"&&<div className="pro-review"><label>Feedback for the creator<Textarea value={notes[v.id]??v.reviewNote??""} maxLength={2000} onChange={e=>setNotes(n=>({...n,[v.id]:e.target.value}))}/></label><div className="pros-views"><Button disabled={busy||v.status==="approved"} onClick={()=>action(async()=>{await api("review",{id:v.id,status:"approved",note:notes[v.id]??v.reviewNote??"",updated:v.updated});})}>Approve</Button><Button variant="outline" disabled={busy||v.status==="rejected"} onClick={()=>action(async()=>{await api("review",{id:v.id,status:"rejected",note:notes[v.id]??v.reviewNote??"",updated:v.updated});})}>{v.status==="approved"?"Remove approval":"Reject"}</Button></div></div>}
    </article>)}</div>:<div className="cinema-empty"><Film size={44}/><h2>{scope==="gallery"?"The Pros is waiting for its first premiere.":"No submissions in this view."}</h2><p>{scope==="gallery"?"Upload your finished video. Once approved, it joins the collection.":"Try another category, search, or page."}</p></div>}
    {(page>0||more)&&<div className="pros-pagination"><Button disabled={!page} variant="outline" onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page+1}</span><Button disabled={!more} variant="outline" onClick={()=>setPage(p=>p+1)}>Next</Button></div>}
    </>}
    <Dialog open={open} onOpenChange={v=>{if(!uploading)setOpen(v);}}><DialogContent className="pro-upload-dialog"><DialogTitle>Submit to The Pros</DialogTitle><DialogDescription>Upload your finished video for admin approval. MP4 (H.264) or WebM, up to 5 GB. Keep this page open during upload.</DialogDescription>
      <form className="pro-upload-form" onSubmit={e=>{e.preventDefault();upload();}}><fieldset disabled={uploading||!!session.current}>
        <label>Video file<Input required type="file" accept="video/mp4,video/webm,.mp4,.webm" onChange={e=>{const f=e.target.files?.[0]||null;setFile(f);setProgress(0);if(f&&!title)setTitle(f.name.replace(/\.[^.]+$/,"").slice(0,120));}}/>{file&&<small>{file.name} · {(file.size/1024**2).toFixed(1)} MB</small>}</label>
        <label>Title<Input value={title} onChange={e=>setTitle(e.target.value)} required maxLength={120}/></label><label>Creator credit<Input value={creator} onChange={e=>setCreator(e.target.value)} required maxLength={100}/></label>
        <label>Category<Select value={format} onValueChange={setFormat}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{CATEGORIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></label>
        <label>Description<Textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={2000}/></label>
        <label className="pro-rights"><Checkbox checked={rights} onCheckedChange={v=>setRights(v===true)}/> I have permission to upload this video and share it with viewers of The Pros.</label>
      </fieldset>
      {(uploading||session.current)&&<div role="status"><progress value={progress} max={100}/><p>{progress===100?"Finishing submission…":`${progress}% uploaded`}</p></div>}{uploadError&&<p role="alert" className="pro-upload-error">{uploadError}</p>}
      <Button type="submit" disabled={uploading||!file||!rights}>{uploading?<><Loader2 className="spin"/> Uploading…</>:session.current?"Resume upload":"Upload & submit for approval"}</Button>
      {uploading&&<Button type="button" variant="outline" onClick={()=>{cancelled.current=true;}}>Pause after this part</Button>}
      {!uploading&&session.current&&<Button type="button" variant="outline" onClick={async()=>{try{await api("cancel",{id:session.current!.id});session.current=null;setProgress(0);setUploadError("");}catch(e){setUploadError((e as Error).message);}}}>Discard unfinished upload</Button>}
      </form></DialogContent></Dialog>
    <Dialog open={!!playing} onOpenChange={v=>{if(!v)setPlaying(null);}}><DialogContent className="screening-player"><DialogTitle>{playing?.title}</DialogTitle><DialogDescription>By {playing?.creator} · {playing?.category} · {playing&&duration(playing.duration)}</DialogDescription>{playing&&<video controls autoPlay playsInline src={`/api/pros/media?id=${playing.id}`} onError={()=>setPlayError(true)}/>} {playError&&<p role="alert">This video could not be played. It may be unavailable or use an unsupported codec. Try reopening it or ask the creator for an MP4 (H.264) version.</p>}</DialogContent></Dialog>
  </section>;
}
