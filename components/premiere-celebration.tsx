"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Clapperboard, Play } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Production = { id: string; title: string; status: string; outputKey?: string };
export default function PremiereCelebration({ project, onWatch }: { project: Production | null; onWatch: () => void }) {
  const previous = useRef<Production | null>(null);
  const celebrated = useRef(new Set<string>());
  const [premiere, setPremiere] = useState<Production | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = project;
    if (premiere && project?.id !== premiere.id) setPremiere(null);
    if (!project || !project.outputKey || project.status !== "complete") return;
    const key = `${project.id}:${project.outputKey}`;
    if (before?.id !== project.id || before.status === "complete" || celebrated.current.has(key)) return;
    celebrated.current.add(key);
    setPremiere(project);
  }, [project, premiere]);
  return <Dialog open={!!premiere} onOpenChange={open => { if (!open) setPremiere(null); }}>
    <DialogContent className="premiere-dialog">
      <div className="premiere-confetti" aria-hidden="true">{Array.from({length:32},(_,i)=><i key={i} style={{"--x":`${(i*37)%100}%`,"--delay":`${(i%8)*0.12}s`,"--turn":`${i%2?360:-360}deg`,background:["#d2ed76","#f7c66a","#f4f3e8","#a5bbd4"][i%4]} as CSSProperties}/>)}</div>
      <div className="premiere-icon" aria-hidden="true"><Clapperboard size={42}/></div>
      <span className="premiere-eyebrow">THAT’S A WRAP!</span>
      <DialogTitle>Your movie is ready.</DialogTitle>
      <DialogDescription>The script became a world. The world became a movie. Now comes the good part: watching it.</DialogDescription>
      <p className="premiere-title">{premiere?.title}</p>
      <Button className="premiere-watch" onClick={()=>{setPremiere(null);onWatch();}}><Play size={18}/> Let’s watch it</Button>
      <button className="premiere-later" onClick={()=>setPremiere(null)}>Save the premiere for later</button>
    </DialogContent>
  </Dialog>;
}
