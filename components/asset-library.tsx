"use client";
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,FolderOpen,Images,Search,Download,ArrowUpRight,Loader2} from 'lucide-react';
import MobileNavigation from '@/components/mobile-navigation';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {ASSET_GROUPS} from '@/services/asset-library.mjs';
const media=(key:string)=>`/api/media?key=${encodeURIComponent(key)}`;
async function api(action:string,data:any={}){const r=await fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data})});const d:any=await r.json();if(!r.ok)throw new Error(d.error||'Could not load your image library.');return d;}
export default function AssetLibrary(){
 const [productions,setProductions]=useState<any[]>([]),[series,setSeries]=useState<any[]>([]),[selected,setSelected]=useState<any>(null),[assets,setAssets]=useState<any[]>([]);
 const [query,setQuery]=useState(''),[group,setGroup]=useState('All images'),[source,setSource]=useState('All sources'),[seriesId,setSeriesId]=useState('all'),[preview,setPreview]=useState<any>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[cursor,setCursor]=useState<string|null>(null);const requestId=useRef(0);
 useEffect(()=>{api('list').then(d=>{setProductions(d.productions);setSeries(d.series);const id=new URLSearchParams(location.search).get('production');if(id){const p=d.productions.find((p:any)=>p.id===id);if(p)void openProduction(p);}}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
 async function openProduction(p:any){const id=++requestId.current;setSelected(p);setQuery('');setGroup('All images');setSource('All sources');setAssets([]);setCursor(null);setError('');setLoading(true);history.replaceState({},'',`/assets?production=${p.id}`);try{let next:string|null=null;const all:any[]=[];do{const d=await api('imageAssets',{id:p.id,cursor:next});if(id!==requestId.current)return;all.push(...d.assets);next=d.cursor;setAssets([...new Map(all.map(a=>[a.key,a])).values()].sort((a,b)=>(a.sequence||0)-(b.sequence||0)||a.name.localeCompare(b.name,undefined,{numeric:true})));setCursor(next);}while(next);}catch(e){if(id===requestId.current)setError((e as Error).message);}finally{if(id===requestId.current)setLoading(false);}}
 const back=()=>{requestId.current++;setSelected(null);setAssets([]);setLoading(false);setQuery('');setError('');history.replaceState({},'','/assets');};
 const visible=assets.filter(a=>(group==='All images'||a.group===group)&&(source==='All sources'||a.source===source)&&`${a.name} ${a.description}`.toLowerCase().includes(query.toLowerCase()));
 const folders=productions.filter(p=>(seriesId==='all'||p.seriesId===seriesId)&&`${p.title} ${p.category}`.toLowerCase().includes(query.toLowerCase()));
 return <div className="asset-library-shell">
  <header className="asset-library-header"><a href="/library"><ArrowLeft size={18}/> Library</a><span>THE BIG SLOP / ASSETS</span><a href="/">Studio <ArrowUpRight size={18}/></a></header>
  <main className="asset-library-main">
   <div className="asset-library-heading"><div><span className="eyebrow">YOUR PRODUCTION ARCHIVE</span><h1>{selected?selected.title:'Every image. In its place.'}</h1><p>{selected?`${selected.category} · ${assets.length} saved images${loading?' · Loading…':''}`:'Cast, worlds, props and every shot — organized by production.'}</p></div><Images size={42}/></div>
   {selected && <div className="asset-breadcrumb"><Button variant="outline" onClick={back}><ArrowLeft/> All productions</Button><Button asChild variant="outline"><a href={`/?project=${selected.id}`}>Open in studio <ArrowUpRight/></a></Button></div>}
   <div className="asset-library-toolbar"><label className="asset-search"><Search size={18}/><Input aria-label={selected?'Search image names and descriptions':'Search productions'} value={query} onChange={e=>setQuery(e.target.value)} placeholder={selected?'Find an image, character or shot…':'Find a production…'}/></label>
    {selected?<Select value={source} onValueChange={setSource}><SelectTrigger aria-label="Image source"><SelectValue/></SelectTrigger><SelectContent>{['All sources','Uploaded','Generated','Extracted','Saved'].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>:<Select value={seriesId} onValueChange={setSeriesId}><SelectTrigger aria-label="Filter by series"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All series & standalone</SelectItem>{series.map(s=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>}
   </div>
   {selected && <nav className="asset-type-tabs" aria-label="Image categories">{['All images',...ASSET_GROUPS].map(g=><button key={g} aria-pressed={group===g} onClick={()=>setGroup(g)}>{g}<span>{g==='All images'?assets.length:assets.filter(a=>a.group===g).length}</span></button>)}</nav>}
   {error && <div className="asset-empty" role="alert"><p>{error}</p><Button onClick={()=>selected?openProduction(selected):location.reload()}>Try again</Button></div>}
   {loading && <p className="asset-loading" role="status"><Loader2 className="spin" size={18}/> Loading your images…</p>}
   {!selected?<div className="asset-folder-grid">{folders.map(p=><button className="asset-folder" key={p.id} onClick={()=>openProduction(p)}><div className="asset-folder-cover">{p.posterKey?<img src={media(p.posterKey)} alt="" loading="lazy"/>:<FolderOpen size={40}/>}<span>{p.category}</span></div><div><h2>{p.title}</h2><p>{series.find(s=>s.id===p.seriesId)?.name||'Standalone production'} · {p.status.replaceAll('_',' ')}</p><span>Browse image assets →</span></div></button>)}</div>:<div className="asset-collection">{ASSET_GROUPS.filter(g=>visible.some(a=>a.group===g)).map(g=><section key={g}><div className="asset-section-heading"><h2>{g}</h2><span>{visible.filter(a=>a.group===g).length} images</span></div><div className="asset-image-grid">{visible.filter(a=>a.group===g).map(a=><button key={a.key} className="asset-image-card" onClick={()=>setPreview(a)}><div><img src={media(a.key)} alt={a.name} loading="lazy"/></div><h3>{a.name}</h3><p>{a.source}{a.sequence?` · Sequence ${a.sequence}`:''}</p></button>)}</div></section>)}</div>}
   {!loading && !error && !(selected?visible.length:folders.length) && <div className="asset-empty"><FolderOpen size={36}/><h2>{query?'No matching results':'No images here yet'}</h2><p>{selected?'Images appear here as they are uploaded or generated. Try another category or search.':'Your saved productions will appear here automatically.'}</p></div>}
  </main>
  <MobileNavigation active="projects"/>
  <Dialog open={!!preview} onOpenChange={o=>{if(!o)setPreview(null);}}><DialogContent className="asset-preview"><DialogTitle>{preview?.name}</DialogTitle><DialogDescription>{selected?.title} · {preview?.group} · {preview?.source}</DialogDescription>{preview && <><img src={media(preview.key)} alt={preview.name}/><p className="asset-description">{preview.description}</p><div className="asset-preview-actions"><Button asChild><a href={`${media(preview.key)}&download=1`}><Download/> Download image</a></Button><Button asChild variant="outline"><a href={media(preview.key)} target="_blank" rel="noreferrer">Open full size <ArrowUpRight/></a></Button></div></>}</DialogContent></Dialog>
 </div>;
}
