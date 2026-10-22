"use client";
import { browserStudioRequest } from "@/services/browser-studio.mjs";
import MobileNavigation from "@/components/mobile-navigation";
import { ProductionTitleEditor } from "@/components/production-title-editor";
import PremiereCelebration from "@/components/premiere-celebration";
import StoryboardReview from "@/components/storyboard-review";
import ReferenceReview from "@/components/reference-review";
import ReferenceDownload from "@/components/reference-download";
import { CATEGORIES, categoryOf } from "@/services/production-categories.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Clock3,
  FileText,
  Film,
  FolderOpen,
  Image,
  Loader2,
  LockKeyhole,
  MapPin,
  Plus,
  Settings2,
  Sparkles,
  Upload,
  Users,
  Wallet,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ProductionProgress,
  TimeEstimates,
} from "@/components/production-progress";
import { Checkbox } from "@/components/ui/checkbox";
import { DIALOGUE_LANGUAGES, productionSettings } from "@/services/production-direction.mjs";

type Asset = {
  id: string;
  name: string;
  kind: string;
  description: string;
  imageKey?: string;
  editSourceKey?: string;
  prompt?: string;
};
type Project = {
  id: string;
  title: string;
  format: string;
  category?: string;
  seriesId?: string | null;
  script: string;
  style: string;
  dialogueLanguage?: string;
  dialogueLanguages?: string[];
  textLanguages?: string[];
  languageNotes?: string;
  resolution?: string;
  productionBible?: string;
  safetyDirection?: string;
  safetyWardrobeNote?: string;
  storyboardsApprovedAt?: number;
  status: string;
  targetMinutes?: number;
  planId?: string;
  workStage?: string;
  progress?: any;
  paidAt?: number;
  generationAuthorization?: { kind: string; approvedAt: number };
  checkoutId?: string;
  phase: string;
  error?: string;
  recoveryEvents?: {
    at: number;
    itemId: string;
    kind: string;
    message: string;
  }[];
  assets: Asset[];
  clips: any[];
  quote?: {
    id: string;
    totalCents: number;
    providerCents: number;
    serviceCents: number;
    expiresAt: number;
  };
  outputKey?: string;
  ideaDraft?: {idea:string;parts:string[]};
};
const sample = `INT. DINER - NIGHT\n\nRain needles the windows of an empty roadside diner. A jukebox plays to nobody.\n\nMARA, a waitress in a faded yellow uniform, wipes the same spot on the counter. A small brass bell sits beside the register.\n\nThe door opens. ELI enters, carrying a battered red suitcase.\n\nMARA\nWe're closed.\n\nELI\nYour sign says open.\n\nMARA\nThe sign's an optimist.\n\nHe puts the suitcase on a stool. Something inside it rings.\n\nELI\nJust a coffee. And maybe some advice.\n\nMara looks at the suitcase. Then at the brass bell.\n\nMARA\nCoffee's two dollars. Advice depends on what's in the bag.\n\nEXT. DINER - NIGHT\n\nThe neon sign flickers. For one moment, the rain falls upward.\n\nFADE OUT.`;
const stages = [
  { name: "The script", icon: FileText },
  { name: "Plan & build", icon: Image },
  { name: "The greenlight", icon: Wallet },
  { name: "Your movie", icon: Film },
];
const formats = CATEGORIES;
const missionStatement = "Our goal is a “slopless” feature film from uploading only a script. We’re not there yet. Getting there will take time, money, and experimentation as AI models keep improving.";
const conceptFilmStatement = "The best use today is a full concept film at 480p: see your idea from beginning to end, get inspired by what it could become, and spot story or pacing changes before investing in your next version.";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
export default function Studio() {
  const [title, setTitle] = useState("Untitled masterpiece"),
    [format, setFormat] = useState("Feature film"),
    [seriesId, setSeriesId] = useState<string | null>(null),
    [series, setSeries] = useState<any[]>([]),
    [script, setScript] = useState(""),
    [style, setStyle] = useState("Cinematic"),
    [dialogueLanguages, setDialogueLanguages] = useState<string[]>(["English"]),
    [textLanguages, setTextLanguages] = useState<string[]>(["English"]),
    [languageNotes, setLanguageNotes] = useState(""),
    [resolution, setResolution] = useState("720p"),
    [tab, setTab] = useState(0),
    [project, setProject] = useState<Project | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [modal, setModal] = useState<"help" | "settings" | "projects" | null>(null),
    [agreed, setAgreed] = useState(false),
    [ready, setReady] = useState<any>({}),
    [drag, setDrag] = useState(false),
    [filter, setFilter] = useState("All"),
    [saved, setSaved] = useState(false),
    [targetMinutes, setTargetMinutes] = useState(5),
    [lastSynced, setLastSynced] = useState(Date.now()),
    [workerActive, setWorkerActive] = useState<boolean | undefined>(),
    [editingAssets, setEditingAssets] = useState<Asset[]>([]),
    [selectedAssets, setSelectedAssets] = useState<string[]>([]),
    [referenceChanges, setReferenceChanges] = useState<Record<string,string>>({}),
    [commitOpen, setCommitOpen] = useState(false),
    [commitAgreed, setCommitAgreed] = useState(false),
    [seriesOpen, setSeriesOpen] = useState(false),
    [seriesName, setSeriesName] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [idea, setIdea] = useState("");
  const ideaRequest = useRef<{id:string;signature:string}|null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const quoteSection = useRef<HTMLDivElement>(null);
  const [jumpToQuote, setJumpToQuote] = useState(0);
  const quoteVisible = !!project?.quote && (!project.clips.some(c=>c.storyboard?.length) || !!(project.storyboardsApprovedAt && project.clips.every(c=>c.storyboard?.every((s:any)=>s.imageKey && s.approvedImageKey===s.imageKey))));
  const goToNextStep = () => {
    setTab(2);
    setJumpToQuote(value => value + 1);
  };
  useEffect(() => {
    if (!jumpToQuote || tab !== 2 || !quoteVisible) return;
    const target = quoteSection.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "start",
    });
    setJumpToQuote(0);
  }, [jumpToQuote, tab, quoteVisible]);
  const paymentsOn = ready.paymentsEnabled === true;
  const [quoteClock, setQuoteClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setQuoteClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const quoteNeedsRefresh = !!project?.quote && (!Number.isFinite(project.quote.expiresAt) || project.quote.expiresAt <= quoteClock + (paymentsOn ? 31 * 60 * 1000 : 0));
  const approvedCost = project?.quote
    ? paymentsOn
      ? project.quote.totalCents
      : project.quote.providerCents
    : 0;
  const words = script.trim() ? script.trim().split(/\s+/).length : 0;
  const validRuntime = Number.isFinite(targetMinutes) && targetMinutes >= 0.5 && targetMinutes <= 360 && Number.isInteger(targetMinutes * 2);
  const estimated = Math.max(1, Math.ceil(words / 150));
  const api = useCallback((action:string,data:any={},signal?:AbortSignal) => browserStudioRequest(action,data,{signal}), []);
  const load = useCallback((p: Project) => {
    setConnectionMessage("");
    setProject(p);
    setSelectedAssets([]);
    setTitle(p.title);
    setFormat(categoryOf(p));
    setSeriesId(p.seriesId || null);
    setScript(p.script);
    setStyle(p.style);
    const settings = productionSettings(p);
    setDialogueLanguages(settings.dialogueLanguages);
    setTextLanguages(settings.textLanguages);
    setLanguageNotes(settings.languageNotes);
    setResolution(settings.resolution);
    setTargetMinutes(p.targetMinutes || p.clips.length / 2 || 5);
    setSaved(true);
    dirty.current = false;
    setAgreed(false);
    setTab(
      ["draft","writing"].includes(p.status)
        ? 0
        : ["planning", "planned", "preparing", "references_ready", "storyboards_ready"].includes(p.status) ||
            (p.status === "failed" && !p.paidAt && !p.generationAuthorization)
          ? 1
          : p.status === "ready"
            ? 2
            : 3,
    );
  }, []);
  useEffect(() => {
    fetch("/api/library",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"list"})}).then(r=>r.json()).then((r:any)=>setSeries(r.series || [])).catch(()=>{});
    const controller=new AbortController();
    let retry:ReturnType<typeof setTimeout>;
    const connect=async()=>{
      try {
        const r=await api("list",{},controller.signal);
        if(controller.signal.aborted)return;
        setConnectionMessage("");setProjects(r.projects);setReady(r.ready);setLastSynced(Date.now());
        const params=new URLSearchParams(window.location.search),id=params.get("project");
        if(id && !dirty.current){
          const p=(await api("get",{id},controller.signal)).project;
          if(controller.signal.aborted)return;
          if(!dirty.current)load(p);
          if(params.has("session_id"))api("verifyPayment",{id,sessionId:params.get("session_id")}).then(r=>{if(!controller.signal.aborted)load(r.project);}).catch(e=>{if(!controller.signal.aborted)setMessage(e.message);});
        }
      }catch(e:any){
        if(controller.signal.aborted)return;
        if(e.connection){setConnectionMessage(e.message);retry=setTimeout(connect,5000);}
        else setMessage(e.message);
      }
    };
    void connect();
    return()=>{controller.abort();clearTimeout(retry);};
  }, [api, load]);
  useEffect(() => {
    if (
      !project ||
      !["writing", "planning", "preparing", "rendering", "stitching", "queued"].includes(
        project.status,
      )
    )
      return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const r=await api("get",{id:project.id},controller.signal);
        if(controller.signal.aborted)return;
        setConnectionMessage("");
        if(project.status === "writing" && r.project.status !== "writing") { load(r.project); setTab(0); }
        else {setProject(r.project);if(project.status === "writing") setScript(r.project.script);}
        setReady(r.ready);setWorkerActive(r.workerActive);setLastSynced(Date.now());
        if(r.project.status === "ready")setTab(2);
        if(["references_ready","storyboards_ready"].includes(r.project.status))setTab(1);
        if(r.project.status === "complete")setTab(3);
      }catch(e){if(!controller.signal.aborted)setConnectionMessage(e instanceof Error?e.message:"Reconnecting to the studio…");}
      finally{if(!controller.signal.aborted)timer=setTimeout(poll,5000);}
    };
    timer=setTimeout(poll,5000);
    return()=>{controller.abort();clearTimeout(timer);};
  }, [project?.id, project?.status, api, load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const r = await api("save", {
      id: project?.id,
      title,
      format,
      seriesId,
      script,
      style,
      targetMinutes,
      dialogueLanguages,
      textLanguages,
      languageNotes,
      resolution,
    });
    setProject(r.project);
    setSaved(true);
    dirty.current = false;
    window.history.replaceState({}, "", `/?project=${r.project.id}`);
    setProjects((ps) => [
      r.project,
      ...ps.filter((p) => p.id !== r.project.id),
    ]);
    return r.project;
  };
  const prepare = () =>
    run(async () => {
      const p = await save();
      const r = await api("prepare", { id: p.id });
      setProject(r.project);
      setTab(1);
    });
  const edit = () => {
    dirty.current = true;
    setSaved(false);
  };
  const newProject = () => {
    setProject(null);
    setSelectedAssets([]);
    setFormat("Feature film");
    setSeriesId(null);
    setTitle("Untitled masterpiece");
    setTargetMinutes(5);
    setDialogueLanguages(["English"]);
    setTextLanguages(["English"]);
    setLanguageNotes("");
    setResolution("720p");
    setScript("");
    setTab(0);
    setSaved(false);
    setMessage("");
    setModal(null);
    setAgreed(false);
    window.history.replaceState({}, "", "/");
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    setMessage("");
    if (file.size > 10 * 1024 * 1024) {
      setMessage("Please upload a script smaller than 10 MB.");
      return;
    }
    if (!/\.(txt|fountain|fdx|pdf|docx)$/i.test(file.name)) {
      setMessage("Choose a PDF, DOCX, TXT, Fountain, or Final Draft file.");
      return;
    }
    setBusy(true);
    try {
      let text = "";
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension === "pdf") {
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
        });
        try {
          const pdf = await task.promise;
          const pages = [];
          for (let n = 1; n <= pdf.numPages; n++) {
            const page = await pdf.getPage(n);
            const content = await page.getTextContent({
              includeMarkedContent: false,
            });
            pages.push(
              content.items
                .filter((item: any) => "str" in item)
                .map((item: any) => item.str + (item.hasEOL ? "\n" : ""))
                .join(""),
            );
          }
          text = pages.join("\n\n");
        } finally {
          await task.destroy();
        }
      } else if (extension === "docx") {
        const mod = await import("mammoth/mammoth.browser");
        text = (
          await (mod.default ?? mod).extractRawText({
            arrayBuffer: await file.arrayBuffer(),
          })
        ).value;
      } else {
        text = await file.text();
        if (extension === "fdx") {
          const xml = new DOMParser().parseFromString(text, "application/xml");
          if (xml.querySelector("parsererror"))
            throw new Error("This Final Draft file could not be read.");
          text = Array.from(xml.querySelectorAll("Content > Paragraph"))
            .map((p) => p.textContent)
            .join("\n\n");
        }
      }
      if (!text.trim())
        throw new Error(
          "No readable text was found. Scanned PDFs need OCR first; try exporting as TXT.",
        );
      if (text.length > 500000)
        throw new Error("This script exceeds the 500,000-character limit.");
      setScript(text);
      // Uploading a screenplay changes its contents, never the production name.
      edit();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "This script could not be read. Try exporting as TXT.",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "stage_screenplay",
          title: "Stage screenplay",
          description:
            "Place a screenplay in the visible editor for review. Does not save, pay, or start generation.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string" },
              script: { type: "string" },
            },
            required: ["title", "script"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          execute(input: any) {
            if (
              typeof input.title !== "string" ||
              !input.title.trim() ||
              input.title.length > 120 ||
              typeof input.script !== "string" ||
              input.script.length > 500000
            )
              throw new Error("Invalid screenplay");
            if (project && project.status !== "draft")
              throw new Error("This production is locked");
            setTitle(input.title);
            setScript(input.script);
            setTab(0);
            edit();
            return {
              staged: true,
              title: input.title,
              characters: input.script.length,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [project?.id, project?.status]);
  const [projectsExpanded,setProjectsExpanded]=useState(true);
  const [mobileNotes,setMobileNotes]=useState(false);
  const [mobileIdea,setMobileIdea]=useState(false);
  const canReviewReferences = !!project && ["references_ready","storyboards_ready","ready"].includes(project.status) && !project.paidAt && !project.generationAuthorization && !project.checkoutId;
  const locked = !!project && project.status !== "draft";
  const canMoveSeries = !project || ["draft", "ready", "complete"].includes(project.status);
  const saveDetails = () => run(async () => {
    if (!project) return;
    const response = await fetch("/api/library", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"organize",id:project.id,title,category:format,seriesId})});
    const result:any = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save production details.");
    const metadata = {title:result.project.title,format:result.project.format,category:result.project.category,seriesId:result.project.seriesId};
    setProject(current=>current ? {...current,...metadata}:current);
    setProjects(items=>items.map(p=>p.id===project.id?{...p,...metadata}:p));
    setTitle(metadata.title);setFormat(metadata.format);setSeriesId(metadata.seriesId);
    setSaved(true);dirty.current=false;setMessage("Production details saved.");
  });
  const working =
    !!project &&
    ["planning", "preparing", "queued", "rendering", "stitching"].includes(
      project.status,
    );
  const canReplan =
    !!project &&
    ["references_ready", "planned", "ready", "failed"].includes(project.status) &&
    !project.paidAt &&
    !project.generationAuthorization &&
    !project.clips.some((c) => c.requestId || c.videoKey);
  const replan = () =>
    run(async () => {
      const r = await api("replan", { id: project!.id, targetMinutes });
      load(r.project);
      setTab(1);
      setLastSynced(Date.now());
    });
  const refreshEstimate = () => run(async () => {
    const r = await api("refreshQuote", { id: project!.id });
    setProject(r.project);
    setCommitOpen(false);
    setCommitAgreed(false);
    setAgreed(false);
    setTab(1);
  });
  const commitProduction = () =>
    run(async () => {
      if (!project?.quote || project.quote.expiresAt <= Date.now() + (paymentsOn ? 31 * 60 * 1000 : 0)) {
        setQuoteClock(Date.now());
        throw new Error("This estimate needs refreshing. Refresh it below, then review and approve the updated price.");
      }
      const r = await api(paymentsOn ? "checkout" : "approveGeneration", {
        id: project!.id,
        accepted: agreed,
        irreversibleAccepted: commitAgreed,
        quoteId: project!.quote!.id,
        providerCents: project!.quote!.providerCents,
      });
      if (paymentsOn) window.location.assign(r.url);
      else {
        load(r.project);
        setTab(3);
        setCommitOpen(false);
        setCommitAgreed(false);
      }
    });
  const stats = [
    {
      icon: Users,
      label: "Characters",
      value: project?.assets.filter((a) => a.kind === "character").length,
    },
    {
      icon: MapPin,
      label: "Locations",
      value: project?.assets.filter((a) => a.kind === "location").length,
    },
    {
      icon: Clapperboard,
      label: "Objects",
      value: project?.assets.filter((a) => a.kind === "object").length,
    },
  ];
  return (
    <div className="studio-shell">
      <header className="mobile-studio-header"><Clapperboard size={25}/><button className="mobile-production-title" onClick={()=>setTab(0)} aria-label="Edit production details"><span>THE BIG SLOP · STUDIO</span><strong>{title}</strong></button><button className="mobile-settings" aria-label="Studio settings" onClick={()=>setModal("settings")}><Settings2 size={22}/></button></header>
      <MobileNavigation onStudio={()=>{setModal(null);window.scrollTo({top:0,behavior:"smooth"});}} active="studio" onNew={newProject}/>

      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Clapperboard size={24} />
          </span>
          <span>
            THE BIG
            <br />
            <b>SLOP</b>
            
          </span>
        </a>
        <div className="workspace-label">YOUR PRODUCTION HOUSE</div>
        <Button className="new-project" onClick={newProject}>
          <Plus size={18} /> New production
        </Button>
        <nav>
          <a className="library-nav" href="/library"><Film /> Watch & library</a>
          <button className="nav-active" onClick={() => setModal(null)}>
            <Clapperboard /> Studio <span>01</span>
          </button>
          <button aria-expanded={projectsExpanded} aria-controls="sidebar-productions" onClick={() => setProjectsExpanded(v=>!v)}>
            <FolderOpen /> Productions <span>{projects.length.toString().padStart(2, "0")}</span><ChevronRight className={projectsExpanded ? "production-chevron expanded" : "production-chevron"}/>
          </button>
          {projectsExpanded && <div id="sidebar-productions" className="sidebar-production-tree">
            {[...new Set(projects.map(p=>categoryOf(p)))].map(category=><details key={category} open>
              <summary>{category}<span>{projects.filter(p=>categoryOf(p)===category).length}</span></summary>
              {projects.filter(p=>categoryOf(p)===category).map(p=><button key={p.id} className="sidebar-production-item" title={p.title} aria-current={project?.id===p.id?'page':undefined} disabled={busy} onClick={()=>run(async()=>{
                if(dirty.current && script.trim()) await save();
                const result=await api("get",{id:p.id});
                window.history.replaceState({},"",`/?project=${p.id}`);load(result.project);setModal(null);
              })}><span className="sidebar-production-name">{p.title}</span><small>{p.status.replaceAll('_',' ')}</small></button>)}
            </details>)}
            {!projects.length && <p>Your saved productions will appear here.</p>}
            <a href="/library?view=productions">Manage productions →</a>
            <a href="/assets">Image assets →</a>
          </div>}
        </nav>
        <div className="sidebar-bottom">
          <div className="slop-stamp">
            <Sparkles size={20} />
            <p>
              Big ideas.
              <br />
              Questionable cinema.
            </p>
            <span>THAT'S THE SPIRIT.</span>
          </div>
          <button onClick={() => setModal("help")}>
            <CircleHelp /> How it works
          </button>
          <button onClick={() => setModal("settings")}>
            <Settings2 /> Studio setup
          </button>
          <form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form>
          <div className="account">
            <span className="avatar">Y</span>
            <div>
              Your studio<small>Independent filmmaker</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Studio</span>
            <ChevronRight size={14} />
            <span>{title}</span>
            {project && <ProductionTitleEditor id={project.id} title={title} onSaved={next => { setTitle(next); setProject(current => current ? {...current, title:next} : current); setProjects(current => current.map(p => p.id === project.id ? {...p,title:next} : p)); }} />}
            <span className="draft-tag">{project?.status || "Draft"}</span>
          </div>
          <div className="topbar-actions">
            <Button variant="ghost" size="sm" onClick={()=>setTab(0)} aria-label="Edit production details"><span className="desktop-action-label">Edit production details</span><span className="phone-action-label">Details</span></Button>
            <a href="/library" className="watch-link" aria-label="Watch & library"><span className="desktop-action-label">Watch & library</span><span className="phone-action-label">Watch</span></a>
            <button
              className="mobile-action"
              aria-label="My productions"
              onClick={() => window.location.assign("/library?view=productions")}
            >
              <FolderOpen size={18} /><span className="phone-action-label">Projects</span>
            </button>
            <button
              className="mobile-action"
              aria-label="New production"
              onClick={newProject}
            >
              <Plus size={18} /><span className="phone-action-label">New</span>
            </button>
            <button
              className="setup-status"
              onClick={() => setModal("settings")}
            >
              <span
                className={
                  ready.generation ? "status-dot" : "status-dot pending"
                }
              />
              {ready.generation ? "Studio connected" : "Connect your studio"}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">FROM PAGE TO PICTURE</div>
              <h1>
                Let’s make a <em>whole</em> movie.
              </h1>
              <p>
                Your script. An entire production crew of AI. Beautifully
                unpredictable.
              </p>
            </div>
            <span className="edition">
              THE DIRECTOR’S DESK <span>VOL. 001</span>
            </span>
          </div>
          {working && (
            <ProductionProgress
              project={project}
              ready={ready}
              workerActive={workerActive}
              lastSynced={lastSynced}
            />
          )}
          <div className="stage-bar">
            {stages.map((s, i) => (
              <button
                key={s.name}
                className={`${tab === i ? "current" : ""} ${i < tab ? "past" : ""}`}
                disabled={
                  (i > 0 && !project) ||
                  (i === 1 && project?.status === "draft") ||
                  (i === 2 && !project?.quote) ||
                  (i === 3 && !["queued", "rendering", "stitching", "complete"].includes(project?.status || "") && !project?.generationAuthorization)
                }
                onClick={() => setTab(i)}
              >
                <span className="step-number">
                  {i < tab ? (
                    <Check size={15} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <s.icon size={17} />
                <span className="desktop-stage-label">{s.name}</span><span className="mobile-stage-label">{["Script","References","Approve","Movie"][i]}</span>
                {i < 3 && <ChevronRight className="step-chevron" size={15} />}
              </button>
            ))}
          </div>
          {project?.status === "ready" && quoteVisible && (
            <div className="next-step-banner">
              <div role="status">
                <strong><Check size={18} aria-hidden="true" /> Your estimate is ready</strong>
                <p>Review the cost and continue below the storyboards.</p>
              </div>
              <Button onClick={goToNextStep}>
                Go to next step <ArrowDown aria-hidden="true" />
              </Button>
            </div>
          )}
          {connectionMessage && <div className="notice" role="status" aria-live="polite"><Loader2 className="animate-spin shrink-0" size={18} /><span>{connectionMessage}</span></div>}
          {message && (
            <div className="notice" role="alert">
              <span>{message}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="workspace-grid">
            <section className="primary-panel">
              {tab === 0 && (
                <>
                  <div className="panel-heading">
                    <div>
                      <span className="small-index">01 /</span>
                      <h2>It starts with a script.</h2>
                    </div>
                    <span className="save-state">
                      {saved && !dirty.current ? (
                        <>
                          <Check size={13} /> Saved
                        </>
                      ) : (
                        "Your next cult classic"
                      )}
                    </span>
                  </div>
                  <div className="script-settings">
                    <label>
                      Production title
                      <Input
                        value={title}
                        maxLength={120}
                        disabled={busy}
                        onChange={(e) => {
                          setTitle(e.target.value);
                          edit();
                        }}
                      />
                    </label>
                    <label>
                      Format
                      <Select
                        value={format}
                        disabled={busy}
                        onValueChange={(v) => {
                          setFormat(v);
                          edit();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {formats.map((f) => (
                            <SelectItem key={f} value={f}>
                              {f}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                  <div className="series-picker">
                    {canMoveSeries && <Button variant="outline" disabled={busy} className="create-series-inline" onClick={()=>{setSeriesName("");setSeriesOpen(true);}}><Plus size={16}/> New series</Button>}
                    <label>Series / recurring project
                      <Select value={seriesId || "standalone"} disabled={!canMoveSeries || busy} onValueChange={v=>{setSeriesId(v==="standalone"?null:v);edit();}}>
                        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                          <SelectItem value="standalone">Standalone production</SelectItem>
                          {series.map(s=><SelectItem key={s.id} value={s.id}>{s.name} · {s.referenceCount} references</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </label>
                    <p>{seriesId ? "Saved characters, locations, props and the visual guide will be reused when planning this episode." : "Making a recurring show? Create a series in your library to keep its world consistent."} <a href="/library?view=productions">Manage series & categories</a></p>
                  </div>
                  {locked && <div className="supplied-reference-panel">
                    <Button disabled={busy || !title.trim()} onClick={saveDetails}>{busy ? "Saving…" : "Save production details"}</Button>
                    <p>You can change the title and format at any stage. {!canMoveSeries && "Series changes unlock when preparation or video generation finishes. "}The script, visual style, languages and resolution stay locked while writing or production work is underway. A generated script becomes editable when the first draft is ready.</p>
                    {["planned","references_ready","ready"].includes(project.status) && !project.paidAt && !project.generationAuthorization && !project.checkoutId && <Button variant="outline" onClick={()=>setTab(1)}>Edit reference images & runtime</Button>}
                    {project.seriesId && ["ready","complete"].includes(project.status) && <Button variant="outline" disabled={busy} onClick={()=>run(async()=>{
                      const response=await fetch("/api/library",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"adoptReferences",id:project.id})});
                      const result:any=await response.json();if(!response.ok)throw new Error(result.error || "Could not update shared references.");
                      setMessage("These references are now saved for future episodes in this series.");
                    })}>Use these references for future episodes</Button>}
                  </div>}
                  {!locked && <><button className="mobile-idea-toggle" aria-expanded={mobileIdea} onClick={()=>setMobileIdea(v=>!v)}><Sparkles size={18}/> No script yet? Start with an idea <ChevronRight size={18}/></button><section className="idea-writer" data-mobile-expanded={mobileIdea}>
                    <span className="eyebrow">FROM A SPARK TO A SCREENPLAY</span>
                    <h3>Only have an idea? Start here.</h3>
                    <p>Tell us the premise, audience, tone and anything that must happen. Your screenwriter will create a complete first draft for your chosen category and length.</p>
                    <label>Your idea<Textarea value={idea} maxLength={10000} onChange={e=>setIdea(e.target.value)} disabled={busy} placeholder="A night-shift waitress discovers that the last customer can hear tomorrow’s news…"/></label>
                    <div className="idea-writer-options"><label>Video category<Select value={format} disabled={busy} onValueChange={v=>{setFormat(v);edit();}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{formats.map(f=><SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent></Select></label>
                    <label>Length in minutes<Input type="number" value={targetMinutes} min={0.5} max={360} step={0.5} disabled={busy} onChange={e=>{setTargetMinutes(Number(e.target.value));edit();}}/></label></div>
                    <p>Uses your dialogue languages ({dialogueLanguages.join(", ") || "no speech"}), on-screen text languages and visual style below. Approximately {Math.ceil(targetMinutes/5)}–{Math.ceil(targetMinutes/5)*3} minutes to write, plus queue time. Script writing uses the studio’s OpenAI credits.</p>
                    <Button disabled={busy || idea.trim().length<10 || !validRuntime} onClick={()=>run(async()=>{
                      if(script.trim()) await save();
                      const data={idea,title,format,seriesId,style,targetMinutes,dialogueLanguages,textLanguages,languageNotes,resolution};
                      const signature=JSON.stringify(data);
                      if(ideaRequest.current?.signature!==signature) ideaRequest.current={id:crypto.randomUUID(),signature};
                      const r=await api("writeIdea",{...data,requestId:ideaRequest.current!.id});
                      load(r.project);window.history.replaceState({},"",`/?project=${r.project.id}`);setProjects(items=>[r.project,...items.filter(p=>p.id!==r.project.id)]);
                    })}>{busy?<Loader2 className="spin"/>:<WandSparkles/>} Write my complete script</Button>
                    <small>Creates a new saved draft. Any current script is saved separately. Review and edit the result before planning images or approving video costs. Runtime is a writing target; the next planning step locks the exact video length.</small>
                  </section></>}
                  {project?.status === "writing" && <div className="idea-writing-status" role="status"><Loader2 className="spin"/><div><b>Your screenwriter is at work</b><p>{project.phase}</p><small>You can close this page. Find this production in your library when you return.</small></div></div>}
                  {project?.ideaDraft && project.status === "failed" && <div className="idea-writing-status" role="alert"><div><b>Script writing paused</b><p>{project.error}</p>{project.script && <Button variant="outline" onClick={()=>{setScript(project.script);setProject(null);setSaved(false);dirty.current=true;window.history.replaceState({},"","/");}}>Continue editing saved sections as a new draft</Button>}</div></div>}
                  {project?.ideaDraft && project.status === "draft" && <div className="idea-writing-status"><Check/><div><b>Your first draft is ready to review.</b><p>Edit the script below, then choose “Plan my runtime.”</p></div></div>}
                  <div className="editor-toolbar">
                    <span>
                      <FileText size={15} /> SCREENPLAY
                    </span>
                    <button
                      disabled={locked || busy}
                      onClick={() => upload.current?.click()}
                    >
                      <Upload size={15} /> Upload script
                    </button>
                  </div>
                  <div
                    className={`script-editor ${drag ? "dragging" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      if (!locked && !busy) readFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <Textarea
                      aria-label="Your screenplay"
                      className="screenplay"
                      disabled={locked || busy}
                      value={script}
                      onChange={(e) => {
                        setScript(e.target.value);
                        edit();
                      }}
                      placeholder={
                        "FADE IN:\n\nINT. YOUR IMAGINATION — DAY\n\nA story that’s been living in your head finally gets its moment.\n\nWrite it here. Paste it in. Or drop your script anywhere in this box."
                      }
                    />
                    {!script && (
                      <div className="sample-prompt">
                        <span>Need an opening scene?</span>
                        <button
                          onClick={() => {
                            setScript(sample);
                            setTitle(current => current === "Untitled masterpiece" || !current.trim() ? "The Last Customer" : current);
                            setFormat("Short film");
                            edit();
                          }}
                        >
                          Try a sample script <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <input
                    ref={upload}
                    type="file"
                    className="sr-only"
                    accept=".pdf,.docx,.txt,.fountain,.fdx"
                    onChange={(e) => readFile(e.target.files?.[0])}
                  />
                  <div className="editor-footer">
                    <span>
                      {words.toLocaleString()} words <i>·</i>{" "}
                      {words
                        ? `~${estimated} min reading estimate`
                        : "The blank page is yours"}
                    </span>
                    <span>.pdf · .docx · .txt · .fdx</span>
                  </div>
                  <div className="look-section">
                    <div>
                      <h3>Set the look</h3>
                      <p>One visual direction for your entire production.</p>
                    </div>
                    <div className="style-options">
                      {[
                        "Cinematic",
                        "Animation",
                        "Film noir",
                        "Stage play",
                      ].map((s) => (
                        <button
                          disabled={locked || busy}
                          className={style === s ? "selected" : ""}
                          onClick={() => {
                            setStyle(s);
                            edit();
                          }}
                          key={s}
                        >
                          {s}
                          {style === s && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="runtime-choice">
                    <LanguageChoices label="What language or languages should the dialogue use?" values={dialogueLanguages} noneLabel="No spoken dialogue" disabled={locked || busy} onChange={(v) => { setDialogueLanguages(v); edit(); }} />
                    <LanguageChoices label="What language or languages should appear on screen?" values={textLanguages} noneLabel="No on-screen text" disabled={locked || busy} onChange={(v) => { setTextLanguages(v); edit(); }} />
                    <label htmlFor="language-notes"><b>Language directions (optional)</b></label>
                    <Textarea id="language-notes" value={languageNotes} maxLength={1000} disabled={locked || busy} placeholder="For example: Mara speaks English, Eli speaks Spanish; signs are in Hebrew." onChange={(e) => { setLanguageNotes(e.target.value); edit(); }} />
                    <p>Choose one or more for each. On-screen text includes signs, screens, titles and scripted subtitles. Lines outside your choices are translated into the first selected language. Review the wording in the shot plan.</p>
                  </div>
                  <div className="runtime-choice">
                    <label htmlFor="video-resolution"><b>Video resolution</b></label>
                    <Select value={resolution} disabled={locked || busy} onValueChange={(value) => { setResolution(value); edit(); }}>
                      <SelectTrigger id="video-resolution"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="480p">480p · recommended first pass</SelectItem>
                        <SelectItem value="720p">720p · HD</SelectItem>
                        <SelectItem value="1080p" disabled>1080p · unavailable in Seedance 2.5</SelectItem>
                      </SelectContent>
                    </Select>
                    <p>We recommend 480p for exploring the full concept at a lower generation cost.</p>
                    <p>Native generation at your chosen resolution. Your estimate uses this choice. 1080p is not enabled in this release.</p>
                  </div>
                  <div className="runtime-choice">
                    <label htmlFor="target-runtime">
                      <b>Choose your finished video length</b>
                    </label>
                    <div>
                      <Input
                        id="target-runtime"
                        type="number"
                        min={0.5}
                        max={360}
                        step={0.5}
                        value={targetMinutes}
                        disabled={locked || busy}
                        onChange={(e) => {
                          setTargetMinutes(Number(e.target.value));
                          edit();
                        }}
                      />
                      <span>
                        minutes · {targetMinutes * 2} × 30-second clips
                      </span>
                    </div>
                    <p>
                      Reading-time guide: about {estimated} minutes. This is
                      only a guide; pauses, action and staging affect pacing.
                      You’ll review the exact shot plan before any new images
                      are generated.
                    </p>
                    {words / targetMinutes > 180 && (
                      <p className="runtime-warning">
                        This is a tight fit for the script. Consider more time
                        or shortening the script to preserve all dialogue.
                      </p>
                    )}
                    <TimeEstimates
                      project={{ script, targetMinutes, assets: [], clips: [] }}
                    />
                  </div>
                  <div className="panel-actions">
                    <Button
                      variant="outline"
                      disabled={busy || !words || locked}
                      onClick={() =>
                        run(async () => {
                          await save();
                        })
                      }
                    >
                      {busy ? <Loader2 className="spin" /> : <FileText />} Save
                      draft
                    </Button>
                    <Button
                      className="primary-action"
                      disabled={busy || words < 10 || locked || !validRuntime}
                      onClick={prepare}
                    >
                      Plan my runtime <ArrowRight />
                    </Button>
                  </div>
                  <div className="below-action">
                    <LockKeyhole size={12} /> You’ll review the full video price
                    before a single clip is made.
                  </div>
                  {!paymentsOn && (
                    <p className="fine-print">
                      Building your world uses the studio’s OpenAI API credits
                      for planning. New images wait for your runtime approval;
                      video generation waits for your separate cost approval.
                      The director automatically revises rejected prompts and
                      tries up to five generations per item, including the
                      original. Replacements may adapt the scene to meet
                      provider policies.
                    </p>
                  )}
                </>
              )}
              {tab === 1 && (
                <>
                  <div className="panel-heading">
                    <div>
                      <span className="small-index">02 /</span>
                      <h2>Your world, taking shape.</h2>
                    </div>
                    <span className="draft-tag">1K REFERENCES</span>
                  </div>
                  {project?.status === "planned" && (
                    <div className="runtime-review">
                      <span className="eyebrow">REVIEW BEFORE IMAGES</span>
                      <h2>
                        {project.clips.length / 2} minutes.{" "}
                        {project.clips.length} clips.
                      </h2>
                      <p>
                        Your chosen runtime is {project.targetMinutes} minutes.
                        The director’s plan matches it exactly.{" "}
                        {project.assets.length} reference images and{" "}
                        {project.clips.reduce((n,c)=>n+(c.storyboard?.length || 1),0)} storyboard panels make up this
                        production.
                      </p>
                      <ProductionSettingsSummary project={project} />
                      <details>
                        <summary>Review the shot plan</summary>
                        {project.productionBible && <p><b>Continuity guide:</b> {project.productionBible}</p>}
                        {project.clips.map((c, i) => (
                          <div className="shot-review" key={c.id}>
                            <b>
                              Clip {i + 1} · {i * 30}–{(i + 1) * 30} seconds
                            </b>
                            <p>{c.prompt}</p>
                            {c.transition && <p><b>{c.transition === "continue" ? "Continue from previous clip’s final frame" : "New scene frame"}:</b> {c.transitionReason}</p>}
                            {c.openingState && <p>Opening: {c.openingState}<br />Closing: {c.closingState}</p>}
                            {c.dialogue?.map((line: any, n: number) => <p key={`d${n}`}><b>{line.speaker} · {line.language}:</b> {line.text}</p>)}
                            {c.renderedText?.map((line: any, n: number) => <p key={`t${n}`}><b>On-screen · {line.language} · {line.placement}:</b> {line.text}</p>)}
                          </div>
                        ))}
                      </details>
                      <TimeEstimates project={project} />
                      <p>
                        Continuing generates missing images and frames using
                        OpenAI credits. You can revise references before
                        committing to video.
                      </p>
                      <Button
                        className="primary-action"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const r = await api("approvePlan", {
                              id: project.id,
                              planId: project.planId,
                              accepted: true,
                            });
                            setProject(r.project);
                            setLastSynced(Date.now());
                          })
                        }
                      >
                        Approve {project.clips.length / 2}-minute plan & build
                        images <ArrowRight />
                      </Button>
                    </div>
                  )}
                  {canReplan && (
                    <div className="runtime-change">
                      <div>
                        <b>Change the runtime before video starts</b>
                        <p>
                          Replanning keeps usable reference images and rebuilds
                          the shot plan. New frames need generation; earlier API
                          usage cannot be undone.
                        </p>
                      </div>
                      <label>
                        Target minutes
                        <Input
                          aria-label="Replan target minutes"
                          type="number"
                          min={0.5}
                          max={360}
                          step={0.5}
                          value={targetMinutes}
                          onChange={(e) =>
                            setTargetMinutes(Number(e.target.value))
                          }
                        />
                      </label>
                      <Button
                        variant="outline"
                        disabled={busy || !validRuntime}
                        onClick={replan}
                      >
                        Replan runtime
                      </Button>
                    </div>
                  )}
                  {project?.status !== "planning" &&
                    project?.status !== "planned" && (
                      <TimeEstimates project={project || {}} />
                    )}
                  {project && <StoryboardReview project={project} onChange={p=>{load(p);setAgreed(false);setCommitOpen(false);}}/>}
                  <div className="phase-message">
                    <WandSparkles />
                    <div>
                      <h3>
                        {project?.status === "ready"
                          ? "The whole cast is here."
                          : project?.status === "storyboards_ready" ? "Your storyboards need your approval." : project?.status === "references_ready" ? "Your references are ready for review."
                          : project?.status === "planned" ? "Your runtime plan is ready." : project?.status === "failed" ? "Your production needs attention." : "Your AI crew is at work."}
                      </h3>
                      <p>
                        {project?.phase ||
                          "Breaking down your script into characters, locations, objects, and 30-second shots."}
                      </p>
                    </div>
                  </div>
                  {project?.error && (
                    <div className="notice">{project.error}</div>
                  )}
                  {!!project?.assets.length && (
                    <p className="fine-print">
                      When all reference images are ready, production pauses for your review. Nothing continues until you press Done.
                    </p>
                  )}
                  {project && <ReferenceDownload key={`download-${project.id}`} project={project}/>}
                  {canReviewReferences && <ReferenceReview key={project!.id} project={project} onComplete={p=>{setProject(p);setTab(1);}}/>}
                  {!canReviewReferences && <>
                  <div className="asset-tabs">
                    {["All", "character", "location", "object"].map((f) => (
                      <button
                        key={f}
                        className={filter === f ? "selected" : ""}
                        onClick={() => setFilter(f)}
                      >
                        {f === "All" ? "All assets" : f + "s"}
                      </button>
                    ))}
                  </div>
                  {project?.status === "ready" && !project.paidAt && !project.generationAuthorization && !project.checkoutId && (
                    <div className="reference-batch-toolbar">
                      <strong>{selectedAssets.length} selected</strong>
                      <Button variant="outline" disabled={busy} onClick={()=>setSelectedAssets(project.assets.filter(a=>a.imageKey && (filter==="All" || a.kind===filter)).map(a=>a.id))}>Select all shown</Button>
                      <Button variant="ghost" disabled={busy || !selectedAssets.length} onClick={()=>setSelectedAssets([])}>Clear selection</Button>
                      <Button disabled={busy || !selectedAssets.length} onClick={()=>{setEditingAssets(project.assets.filter(a=>selectedAssets.includes(a.id)));setReferenceChanges({});setMessage("");}}>Change selected ({selectedAssets.length})</Button>
                    </div>
                  )}
                  <div className="asset-grid">
                    {project?.assets
                      .filter((a) => filter === "All" || a.kind === filter)
                      .map((a) => (
                        <article key={a.id} className="asset-card">
                          {a.imageKey || a.editSourceKey ? (
                            <img
                              loading="lazy"
                              decoding="async"
                              src={`/api/media?key=${encodeURIComponent(a.imageKey || a.editSourceKey || "")}`}
                              alt={a.description}
                            />
                          ) : (
                            <div className="asset-pending">
                              <Image size={28} />
                              <span>Waiting for its close-up</span>
                            </div>
                          )}
                          <div>
                            {project?.status === "ready" && !project.paidAt && !project.generationAuthorization && !project.checkoutId && a.imageKey && <label className="reference-select"><Checkbox disabled={busy} checked={selectedAssets.includes(a.id)} onCheckedChange={checked=>setSelectedAssets(ids=>checked===true?[...ids.filter(id=>id!==a.id),a.id]:ids.filter(id=>id!==a.id))}/><span>Select {a.name}</span></label>}
                            <span>{a.kind}</span>
                            <h3>{a.name}</h3>
                            <p>{a.description}</p>
                            <Button
                              variant="outline"
                              disabled={
                                busy ||
                                project?.status !== "ready" ||
                                !!project?.paidAt || !!project?.generationAuthorization || !!project?.checkoutId ||
                                !a.imageKey
                              }
                              onClick={() => {
                                setEditingAssets([a]);
                                setReferenceChanges({});
                                setMessage("");
                              }}
                            >
                              Change reference
                            </Button>
                          </div>
                        </article>
                      ))}
                  </div>
                  </>}
                  {!project?.assets.length && (
                    <div className="empty-production">
                      <span className="film-circle">
                        <Clapperboard size={38} />
                      </span>
                      <h3>Every story needs a world.</h3>
                      <p>
                        Your characters, sets, and props will appear here as
                        they are created.
                      </p>
                    </div>
                  )}
                  <div className="panel-actions">
                    <Button variant="outline" onClick={() => setTab(0)}>
                      <ArrowLeft /> View script
                    </Button>
                    <Button
                      disabled={!project?.quote}
                      onClick={() => setTab(2)}
                    >
                      Review the greenlight <ArrowRight />
                    </Button>
                  </div>
                </>
              )}
              {tab === 2 && (
                <>
                  <div className="panel-heading">
                    <div>
                      <span className="small-index">03 /</span>
                      <h2>Give it the greenlight.</h2>
                    </div>
                  </div>
                  {project && <StoryboardReview project={project} onChange={p=>{load(p);setAgreed(false);setCommitOpen(false);}}/>}
                  {project?.quote && quoteVisible ? (
                    <div className="quote-body" ref={quoteSection} tabIndex={-1} aria-label="Production cost and next step">
                      <span className="eyebrow">YOUR ENTIRE PRODUCTION</span>
                      <div className="price">
                        {money(approvedCost)}
                        <span>USD</span>
                      </div>
                      <p>
                        {paymentsOn
                          ? "A fixed production price"
                          : "Estimated video API usage"}{" "}
                        based on published model rates, before any provider
                        discounts. Covers {project.clips.length} clips,
                        assembled into one {project.clips.length / 2}-minute
                        film.
                      </p>
                      <ProductionSettingsSummary project={project} />
                      <div className="quote-line">
                        <span>
                          Seedance 2.5 · {project.clips.length} × 30 seconds ·
                          {project.resolution || "720p"}
                        </span>
                        <b>{money(project.quote.providerCents)}</b>
                      </div>
                      {paymentsOn && (
                        <div className="quote-line">
                          <span>Production, assembly & platform</span>
                          <b>{money(project.quote.serviceCents)}</b>
                        </div>
                      )}
                      <div className="quote-line total">
                        <span>
                          {paymentsOn
                            ? "Total to fund this production"
                            : "Estimated video API cost"}
                        </span>
                        <b>{money(approvedCost)}</b>
                      </div>
                      <TimeEstimates project={project} />
                      <Button variant="outline" onClick={() => setTab(1)}>
                        Review references or change runtime
                      </Button>
                      <div className="quote-controls">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={refreshEstimate}
                        >
                          Refresh quote
                        </Button>
                        {paymentsOn && (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                const r = await api("verifyPayment", {
                                  id: project.id,
                                });
                                load(r.project);
                              })
                            }
                          >
                            Already paid? Check payment
                          </Button>
                        )}
                      </div>
                      <p className="fine-print">
                        Quote valid until{" "}
                        {new Date(project.quote.expiresAt).toLocaleString()}.
                        {paymentsOn
                          ? " No extra generation charges without a new approval. If production fails, request a refund for unspent video funds."
                          : " Payments are off. Video usage is billed directly to the studio’s Higgsfield account. Planning and reference images use its OpenAI account and are separate from this estimate."}
                      </p>
                      <p className="fine-print">
                        Automatic recovery is on: up to five attempts per image
                        or clip, with a six-hour recovery limit per item. Prompt
                        revisions and replacement scene images use additional
                        OpenAI credits. Video retries stay within this approved
                        video estimate; unresolved requests and account issues
                        pause production.
                      </p>
                      <div className="slop-disclosure">
                        <Sparkles />
                        <div>
                          <h3>Yes, it will probably be AI slop.</h3>
                          <p>
                            Faces may wander. Physics may take a day off.
                            Dialogue and continuity can get weird. This is
                            experimental AI cinema, and that’s part of the fun.
                            Expect an imperfect adaptation, not a polished
                            studio film.
                          </p>
                        </div>
                      </div>
                      {quoteNeedsRefresh && <p className="estimate-notice" role="status">This estimate has expired or needs renewing. Refresh it to get a current price. Your images and storyboards are saved; you will approve the new estimate before video generation starts.</p>}
                      <div className="commit-warning">
                        <LockKeyhole />
                        <div>
                          <b>This is the point of no return.</b>
                          <p>
                            After the final confirmation, you cannot cancel or
                            edit this production in the studio. Submitted
                            generations cannot be undone, and credits already
                            spent cannot be recovered here. Review the runtime
                            and references first.
                          </p>
                        </div>
                      </div>
                      <label className="consent">
                        <Checkbox
                          checked={agreed}
                          onCheckedChange={(v) => setAgreed(v === true)}
                        />
                        <span>
                          I embrace the slop and approve {money(approvedCost)}
                          {paymentsOn
                            ? " for this production once payment is confirmed."
                            : " in estimated video API usage. Start generation using the studio’s API accounts."}{" "}
                          I also authorize automatic prompt revisions and
                          replacement images using OpenAI credits.
                        </span>
                      </label>
                      <Button
                        className="checkout-button"
                        disabled={busy || (!quoteNeedsRefresh && !agreed)}
                        onClick={() => {
                          if (quoteNeedsRefresh) { void refreshEstimate(); return; }
                          setCommitAgreed(false);
                          setCommitOpen(true);
                          setMessage("");
                        }}
                      >
                        {busy ? <Loader2 className="spin" /> : <Clapperboard />}
                        {quoteNeedsRefresh ? "Refresh estimate to continue" : paymentsOn
                          ? "Add funds & roll camera"
                          : "Review final confirmation"}{" "}
                        <ArrowRight />
                      </Button>
                      <p className="fine-print centered">
                        {paymentsOn
                          ? "Secure payment through Stripe. Generation starts after verified payment."
                          : "No checkout. No platform fee. Your connected API accounts cover usage."}
                      </p>
                    </div>
                  ) : (
                    <div className="empty-production">
                      Your quote will appear after all reference images are
                      ready.
                    </div>
                  )}
                </>
              )}
              {tab === 3 && (
                <>
                  <div className="panel-heading">
                    <div>
                      <span className="small-index">04 /</span>
                      <h2>
                        {project?.status === "complete"
                          ? "That's a wrap."
                          : project?.status === "failed" ? "Production paused." : "Quiet on set. Rolling."}
                      </h2>
                    </div>
                  </div>
                  <div className="render-body">
                    {project?.outputKey ? (
                      <>
                        <video tabIndex={0}
                          controls
                          src={`/api/media?key=${encodeURIComponent(project.outputKey)}`}
                          className="final-video finished-production-video"
                        />
                        <ProductionSettingsSummary project={project} />
                        <p>Speech and text are not automatically verified yet; review the dialogue, lettering and continuity before sharing.</p>
                        <Button asChild>
                          <a
                            href={`/api/media?key=${encodeURIComponent(project.outputKey)}&download=1`}
                          >
                            <ArrowDownToLine /> Download the full movie
                          </a>
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="render-icon">
                          <Film size={44} />
                        </div>
                        <h3>
                          {project?.phase ||
                            "Your production is waiting for the greenlight."}
                        </h3>
                        <p>
                          You can close this window. Your production keeps
                          running in the background.
                        </p>
                        <div className="clip-track">
                          {project?.clips.map((c, i) => (
                            <span
                              title={`Clip ${i + 1}: ${c.status || "planned"}`}
                              key={i}
                              className={
                                c.status === "complete"
                                  ? "done"
                                  : c.status === "generating"
                                    ? "active"
                                    : ""
                              }
                            >
                              {String(i + 1).padStart(2, "0")}
                            </span>
                          ))}
                        </div>
                        <span>
                          {project?.clips.filter((c) => c.status === "complete")
                            .length || 0}{" "}
                          / {project?.clips.length || 0} clips ready
                        </span>
                        {project?.error && (
                          <div className="notice">{project.error}</div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
              {project?.safetyDirection && (
                <div className="notice">
                  <b>Safe visual adaptation</b>
                  <p>{project.safetyDirection}</p>
                  {project.safetyWardrobeNote && <p>{project.safetyWardrobeNote}</p>}
                  <p>Review the updated references and every storyboard before continuing. Your original script is preserved.</p>
                  {project.clips.some(c=>c.safetyDirectionSummary) && <details>
                    <summary>Review changes by clip</summary>
                    {project.clips.filter(c=>c.safetyDirectionSummary).map(c=><p key={c.id}>{c.id}: {c.safetyDirectionSummary}</p>)}
                  </details>}
                </div>
              )}
              {!!project?.recoveryEvents?.length && (
                <div className="notice" aria-live="polite">
                  <b>Director’s recovery notes</b>
                  {project.recoveryEvents.slice(-4).map((event, i) => (
                    <p key={`${event.at}-${i}`}>
                      {event.itemId}: {event.message}
                    </p>
                  ))}
                </div>
              )}
            </section>
            <aside className="production-sidebar" data-mobile-expanded={mobileNotes}><button className="mobile-notes-toggle" aria-expanded={mobileNotes} onClick={()=>setMobileNotes(v=>!v)}><CircleHelp size={18}/> Production notes & how it works <ChevronRight size={18}/></button>
              <div className="production-card">
                <div className="card-kicker">
                  <Clapperboard size={18} />
                  <span>PRODUCTION NOTES</span>
                </div>
                <h2>
                  A whole world.
                  <br />
                  From your words.
                </h2>
                <p>
                  Lock in your script. We’ll take care of the casting,
                  locations, props, and the very long to-do list.
                </p>
                <div className="asset-counts">
                  {stats.map((s) => (
                    <div key={s.label}>
                      <s.icon size={17} />
                      <span>{s.label}</span>
                      <b>{project ? s.value : "—"}</b>
                    </div>
                  ))}
                </div>
                <div className="model-note">
                  <span className="tiny-spark">✳</span>
                  <div>
                    GPT Image 2.5 Sunburst
                    <small>Every reference. Always 1K.</small>
                  </div>
                </div>
              </div>
              <div className="pipeline-note">
                <div className="eyebrow">THE PRODUCTION LINE</div>
                <div>
                  <span>01</span>
                  <p>You write the story.</p>
                </div>
                <div>
                  <span>02</span>
                  <p>AI builds your world.</p>
                </div>
                <div>
                  <span>03</span>
                  <p>You approve the price.</p>
                </div>
                <div>
                  <span>04</span>
                  <p>We make the whole thing.</p>
                </div>
                <footer>
                  <Film size={15} /> Seedance 2.5 <i>·</i> {project?.resolution || resolution} <i>·</i> 30s
                  clips
                </footer>
              </div>
              <div className="honesty-note">
                <span>PERFECTION IS OVERRATED.</span>
                <p>
                  Will it be a masterpiece?
                  <br />
                  Probably not.
                  <br />
                  <b>Will it be your movie? Absolutely.</b>
                </p>
              </div>
              <div className="honesty-note">
                <span>THE GOAL: SLOPLESS.</span>
                <p>
                  {missionStatement}
                </p>
                <p>{conceptFilmStatement}</p>
                <button onClick={() => setModal("help")}>
                  Where we are today <ArrowRight size={14} />
                </button>
              </div>
            </aside>
          </div>
          <footer className="page-footer">
            <span>
              MADE WITH AMBITION. AND A HEALTHY DISREGARD FOR PERFECTION.
            </span>
            <span>THE BIG SLOP © {new Date().getFullYear()}</span>
          </footer>
        </main>
      </div>
      <PremiereCelebration project={project} onWatch={()=>{setTab(3);requestAnimationFrame(()=>{const video=document.querySelector<HTMLVideoElement>(".finished-production-video");video?.scrollIntoView({block:"center"});video?.focus();void video?.play().catch(()=>{});});}} />
      <Dialog open={seriesOpen} onOpenChange={setSeriesOpen}>
        <DialogContent>
          <DialogTitle>Create a recurring project</DialogTitle>
          <DialogDescription>Keep this script in the editor and give its series a shared home for characters, locations and props. Category: {format}.</DialogDescription>
          <label className="library-field">Series name<Input value={seriesName} maxLength={120} onChange={e=>setSeriesName(e.target.value)} placeholder="Name your show or recurring project"/></label>
          {message && <p role="alert">{message}</p>}
          <Button disabled={busy || !seriesName.trim()} onClick={()=>run(async()=>{
            const response=await fetch("/api/library",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createSeries",name:seriesName,category:format})});
            const result:any=await response.json();if(!response.ok)throw new Error(result.error || "Could not create series.");
            setSeries(items=>[...items,{...result.series,referenceCount:0,episodeCount:0}]);setSeriesId(result.series.id);setSeriesOpen(false);edit();
          })}>{busy?<Loader2 className="spin"/>:<Plus/>} Create & select series</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent>
          <DialogTitle>Start the full production? There’s no undo.</DialogTitle>
          <DialogDescription>
            You are committing {money(approvedCost)} in{" "}
            {paymentsOn ? "production funding" : "estimated video API usage"}{" "}
            for {project?.clips.length ? project.clips.length / 2 : 0} minutes
            of video.
          </DialogDescription>
          <div className="commit-warning">
            <LockKeyhole />
            <p>
              The script, runtime and references become final. You cannot cancel
              or edit the production after starting. Submitted requests cannot
              be recalled through this studio. Automatic recovery can use
              additional OpenAI credits.
            </p>
          </div>
          <label className="consent">
            <Checkbox
              checked={commitAgreed}
              onCheckedChange={(v) => setCommitAgreed(v === true)}
            />
            <span>
              I understand there is no turning back and authorize this
              production to begin.
            </span>
          </label>
          {message && <p role="alert">{message}</p>}
          {quoteNeedsRefresh && <p className="estimate-notice" role="status">Your estimate needs refreshing before production can start. Refresh it, then review and approve the updated price.</p>}
          <Button
            className="primary-action"
            disabled={busy || (!quoteNeedsRefresh && !commitAgreed)}
            onClick={quoteNeedsRefresh ? refreshEstimate : commitProduction}
          >
            {busy ? <Loader2 className="spin" /> : <Clapperboard />}{" "}
            {busy ? (quoteNeedsRefresh ? "Refreshing estimate…" : "Starting production…") : quoteNeedsRefresh ? "Refresh estimate" : paymentsOn ? "Continue to payment" : "Commit & start production"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setCommitOpen(false)}
          >
            Go back and review
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={editingAssets.length > 0} onOpenChange={open=>{if(!open && !busy)setEditingAssets([]);}}>
        <DialogContent className="reference-batch-dialog">
          <DialogTitle>Change {editingAssets.length} reference image{editingAssets.length===1?"":"s"}</DialogTitle>
          <DialogDescription>Describe the changes for each image, then submit them together. Sunburst edits the 1K references before rebuilding shared scene frames once.</DialogDescription>
          <div className="reference-batch-editors">
            {editingAssets.map(a=><div className="reference-batch-item" key={a.id}>
              {a.imageKey && <img src={`/api/media?key=${encodeURIComponent(a.imageKey)}`} alt={a.name}/>}
              <label><strong>{a.name}</strong><span>{a.kind}</span><Textarea disabled={busy} aria-label={`Changes for ${a.name}`} placeholder="For example: make the jacket blue. Keep the same face." value={referenceChanges[a.id] || ""} onChange={e=>setReferenceChanges(changes=>({...changes,[a.id]:e.target.value}))} maxLength={2000}/></label>
            </div>)}
          </div>
          <p className="fine-print">Uses additional OpenAI credits. {project?.clips.filter(c=>c.assetIds?.some((id:string)=>editingAssets.some(a=>a.id===id))).length || 0} affected frames will be rebuilt, and the video quote refreshed. Allow roughly 1–4 minutes per edited image or affected frame, plus queue time. Images are processed in sequence within one batch.</p>
          {message && <p role="alert">{message}</p>}
          <Button disabled={busy || !editingAssets.length || editingAssets.some(a=>(referenceChanges[a.id] || "").trim().length<3)} onClick={()=>run(async()=>{
            const r=await api("reviseReferences",{id:project!.id,edits:editingAssets.map(a=>({assetId:a.id,changes:referenceChanges[a.id]}))});
            load(r.project);setEditingAssets([]);setReferenceChanges({});setTab(1);setLastSynced(Date.now());
          })}>{busy?<Loader2 className="spin"/>:<WandSparkles/>} Save all changes & regenerate</Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!modal}
        onOpenChange={(o) => {
          if (!o) setModal(null);
        }}
      >
        <DialogContent className={`studio-dialog ${modal === "projects" ? "productions-dialog" : modal === "settings" ? "connections-dialog" : ""}`}>
          <DialogTitle>
            {modal === "projects"
              ? "Your productions"
              : modal === "settings"
                ? "Studio connections"
                : "Welcome to imperfect cinema."}
          </DialogTitle>
          <DialogDescription>
            {modal === "projects"
              ? "Saved scripts and every production in progress."
              : modal === "settings"
                ? "Your production tools, securely connected. API keys stay on the server."
                : "A whole script becomes a whole movie. Here’s what to expect."}
          </DialogDescription>
          {modal === "projects" ? (
            <div className="project-list">
              <a href="/assets" className="library-manage-link">Browse all image assets →</a>
              <a href="/library?view=productions" className="library-manage-link">Manage categories, series & references →</a>
              {projects.length ? (
                projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() =>
                      run(async () => {
                        const result = await api("get", { id: p.id });
                        window.history.replaceState(
                          {},
                          "",
                          `/?project=${p.id}`,
                        );
                        load(result.project);
                        setModal(null);
                      })
                    }
                  >
                    <Film />
                    <span className="production-row-copy">
                      <strong className="production-row-title">{p.title}</strong>
                      <small>
                        {categoryOf(p)} · {p.status}
                      </small>
                    </span>
                    <ArrowRight />
                  </button>
                ))
              ) : (
                <p>No productions yet. Your first draft starts here.</p>
              )}
            </div>
          ) : modal === "settings" ? (
            <div className="connection-list">
              {[
                ["OpenAI", "Astra / Sol + Sunburst", ready.openai],
                ["Higgsfield", "Seedance 2.5", ready.higgsfield],
                ...(paymentsOn
                  ? [["Stripe", "Production funding", ready.stripe]]
                  : []),
                [
                  "Render worker",
                  "Background production & stitching",
                  ready.worker,
                ],
              ].map(([name, desc, ok]) => (
                <div key={String(name)}>
                  <span>
                    {name}
                    <small>{desc}</small>
                  </span>
                  <b className={ok ? "connected" : ""}>
                    {ok ? "Connected" : "Setup needed"}
                  </b>
                </div>
              ))}
              <p className="fine-print">
                {paymentsOn
                  ? "Payments are enabled."
                  : "Payments are off. No Stripe account is required. Generation uses the studio’s API accounts."}{" "}
                Live production requires connected API keys and an online render
                worker. This is your self-hosted studio; provider charges go to your accounts.
              </p>
              <form action="/api/auth/logout" method="post"><button type="submit" className="underline">Sign out of this studio</button></form>
            </div>
          ) : (
            <div className="help-content">
              <p><b>The goal: slopless.</b> {missionStatement}</p>
              <p><b>Start with the concept.</b> {conceptFilmStatement}</p>
              <p>
                <b>1. Write it all.</b> Paste a screenplay or upload PDF, DOCX,
                TXT, Fountain, or Final Draft. Review it, choose a look and target runtime, then approve the shot plan before any images are generated.
              </p>
              <p>
                <b>2. Meet your world.</b> Astra or Sol identifies the cast,
                locations, props, and every shot. Sunburst creates all
                references at 1024 × 1024. Use “Change reference” to request corrections; affected scene frames are rebuilt automatically.
              </p>
              <p>
                <b>3. Know the price.</b> After references are finished, review
                the video estimate, accept the imperfections, and{" "}
                {paymentsOn
                  ? "fund the production."
                  : "approve generation with the studio’s API accounts. No payment step."}
              </p>
              <p>
                <b>4. Roll camera.</b> The final confirmation commits the production: runtime and references are locked, with no cancellation in the studio. Seedance 2.5 makes 30-second clips at your chosen 480p or 720p resolution. Continuing shots start from the preceding clip’s final frame; planned cuts use a fresh scene frame. We stitch them into one video in script order.
              </p>
              <div className="slop-disclosure">
                <p>
                  AI slop is part of the deal: visual glitches, inconsistent
                  faces, strange acting, and imperfect dialogue are likely.
                  Bring a sense of humor and a story you have permission to use.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LanguageChoices({ label, values, noneLabel, disabled, onChange }: { label: string; values: string[]; noneLabel: string; disabled: boolean; onChange: (values: string[]) => void }) {
  return <fieldset className="language-choices" disabled={disabled}>
    <legend>{label}</legend>
    <div>
      {DIALOGUE_LANGUAGES.map((language) => <label key={language}><input type="checkbox" checked={values.includes(language)} onChange={(e) => onChange(e.target.checked ? [...values, language] : values.filter(v => v !== language))} />{language}</label>)}
      <label><input type="checkbox" checked={values.length === 0} onChange={(e) => onChange(e.target.checked ? [] : ["English"])} />{noneLabel}</label>
    </div>
  </fieldset>;
}

function ProductionSettingsSummary({ project }: { project: Project }) {
  const settings = productionSettings(project);
  return <p className="production-settings-summary"><b>{settings.resolution}</b> · Dialogue: {settings.dialogueLanguages.join(", ") || "None"}<br />On-screen text: {settings.textLanguages.join(", ") || "None"}</p>;
}
