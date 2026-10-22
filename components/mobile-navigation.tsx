"use client";
import {Clapperboard,Play,FolderOpen,Plus} from 'lucide-react';
export default function MobileNavigation({active,onProjects,onWatch,onNew,onStudio}:{active:'studio'|'watch'|'projects';onProjects?:()=>void;onWatch?:()=>void;onNew?:()=>void;onStudio?:()=>void}) {
 const items=[{key:'studio',label:'Studio',icon:Clapperboard,href:'/',action:onStudio},{key:'watch',label:'Watch',icon:Play,href:'/library',action:onWatch},{key:'projects',label:'Projects',icon:FolderOpen,href:'/library?view=productions',action:onProjects},{key:'new',label:'New',icon:Plus,href:'/',action:onNew}];
 return <nav className="mobile-app-nav" aria-label="Main navigation">{items.map(i=>{const content=<><i.icon size={21}/><span>{i.label}</span></>;return i.action?<button key={i.key} onClick={i.action} aria-current={active===i.key?'page':undefined}>{content}</button>:<a key={i.key} href={i.href} aria-current={active===i.key?'page':undefined}>{content}</a>;})}</nav>;
}
