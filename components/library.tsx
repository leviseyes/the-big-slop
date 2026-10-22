"use client";
import MobileNavigation from "@/components/mobile-navigation";
import { Pros } from "@/components/pros";
import { ProductionTitleEditor } from "@/components/production-title-editor";
import { useEffect, useState } from "react";
import {
  Clapperboard,
  Play,
  Plus,
  ArrowLeft,
  ArrowUpRight,
  Film,
  Layers,
  Search,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CATEGORIES } from "@/services/production-categories.mjs";
type Production = {
  id: string;
  title: string;
  status: string;
  category: string;
  seriesId?: string | null;
  outputKey?: string;
  posterKey?: string;
  targetMinutes?: number;
  clipCount: number;
  resolution?: string;
  created: number;
};
type Series = {
  id: string;
  name: string;
  category: string;
  referenceCount: number;
  episodeCount: number;
  assets?: any[];
  productionBible?: string;
};
const media = (key: string) => `/api/media?key=${encodeURIComponent(key)}`;
async function api(action: string, data: any = {}) {
  const r = await fetch("/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  const result: any = await r.json();
  if (!r.ok)
    throw new Error(
      result.error || "Could not load your library. Please try again.",
    );
  return result;
}
function Poster({
  production,
  hero = false,
}: {
  production: Production;
  hero?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [production.posterKey]);
  return production.posterKey && !failed ? (
    <img
      src={media(production.posterKey)}
      alt=""
      loading={hero ? "eager" : "lazy"}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="poster-fallback">
      <Film size={hero ? 80 : 38} />
      <span>{production.category}</span>
    </div>
  );
}
function CategorySelect({
  value,
  onChange,
  disabled = false,
  label = "Category",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CATEGORIES.map((c: string) => (
          <SelectItem value={c} key={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function Library() {
  const [productions, setProductions] = useState<Production[]>([]),
    [series, setSeries] = useState<Series[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState("watch"),
    [category, setCategory] = useState("All"),
    [query, setQuery] = useState(""),
    [selectedSeries, setSelectedSeries] = useState<Series | null>(null),
    [playing, setPlaying] = useState<Production | null>(null),
    [organizing, setOrganizing] = useState<Production | null>(null),
    [moveCategory, setMoveCategory] = useState("Short film"),
    [moveSeries, setMoveSeries] = useState("none"),
    [createOpen, setCreateOpen] = useState(false),
    [seriesName, setSeriesName] = useState(""),
    [seriesCategory, setSeriesCategory] = useState("TV show");
  const [playerError, setPlayerError] = useState(false),
    [playbackAttempt, setPlaybackAttempt] = useState(0);
  useEffect(() => setPlayerError(false), [playing]);
  function renamed(id: string, title: string) {
    setProductions(items => items.map(p => p.id === id ? {...p,title} : p));
    setPlaying(p => p?.id === id ? {...p,title} : p);
  }
  async function refresh() {
    const r = await api("list");
    setProductions(r.productions);
    setSeries(r.series);
  }
  useEffect(() => {
    setView(
      new URLSearchParams(location.search).get("view") === "productions"
        ? "productions"
        : "watch",
    );
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const visible = productions.filter(
    (p) =>
      (category === "All" || p.category === category) &&
      (!selectedSeries || p.seriesId === selectedSeries.id) &&
      p.title.toLowerCase().includes(query.toLowerCase()),
  );
  const finished = visible.filter(
      (p) => p.status === "complete" && p.outputKey,
    ),
    featured = finished[0];
  const groups = CATEGORIES.map((name: string) => ({
    name,
    items: finished.filter((p) => p.category === name),
  })).filter((g: any) => g.items.length);
  const episodes = playing?.seriesId
    ? productions
        .filter(
          (p) =>
            p.seriesId === playing.seriesId &&
            p.status === "complete" &&
            p.outputKey,
        )
        .sort((a, b) => a.created - b.created)
    : [];
  const next = episodes[episodes.findIndex((p) => p.id === playing?.id) + 1];
  const openSeries = (s: Series) =>
    run(async () => {
      const r = await api("series", { seriesId: s.id });
      setSelectedSeries(r.series);
      setCategory("All");
      setQuery("");
    });
  const newEpisode = (s: Series) =>
    run(async () => {
      const r = await api("newEpisode", { seriesId: s.id });
      location.assign(`/?project=${r.project.id}`);
    });
  function organize(p: Production) {
    setOrganizing(p);
    setMoveCategory(p.category);
    setMoveSeries(p.seriesId || "none");
  }
  return (
    <div className="cinema-shell" data-view={view}>
      <MobileNavigation active={view==="productions"?"projects":"watch"} onProjects={()=>setView("productions")} onWatch={()=>setView("watch")}/>
      <header className="cinema-header">
        <a href="/library" className="cinema-brand">
          <Clapperboard /> THE BIG <b>SLOP</b>
          <span>SCREENING ROOM</span>
        </a>
        <a href="/assets" className="asset-library-link"><FolderOpen size={18}/> Image assets</a>
        <a href="/" className="cinema-studio-link">
          Production studio <ArrowUpRight size={18} />
        </a>
      </header>
      <main className="cinema-main">
        <Tabs value={view} onValueChange={setView}>
          <div className="library-topline">
            <TabsList className="cinema-tabs">
              <TabsTrigger value="watch">
                <Play /> The Slops
              </TabsTrigger>
              <TabsTrigger value="pros"><Film /> The Pros</TabsTrigger>
              <TabsTrigger value="productions">
                <FolderOpen /> Productions
              </TabsTrigger>
            </TabsList>
            <div className="library-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setCreateOpen(true)}
              >
                <Layers /> New series
              </Button>
              <Button asChild>
                <a href="/">
                  <Plus /> New production
                </a>
              </Button>
            </div>
          </div>
          {error && (
            <div className="library-alert" role="alert">
              {error}{" "}
              <button onClick={() => run(refresh)}>Retry loading</button>
            </div>
          )}
          {notice && (
            <p role="status" className="library-notice">
              {notice}
            </p>
          )}
          <div className="library-heading">
            <div>
              <span className="cinema-kicker">YOUR STORIES. ON SCREEN.</span>
              <h1>
                {(view === "pros" ? "The Pros. Worth the spotlight." : selectedSeries?.name) ||
                  (view === "watch"
                    ? "The Slops. Made from imagination."
                    : "Your production library.")}
              </h1>
            </div>
            <label className="library-search">
              <Search size={18} />
              <Input
                aria-label={view === "pros" ? "Search uploaded films" : "Search productions"}
                placeholder={view === "pros" ? "Find a film or creator…" : "Find a production…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {selectedSeries && view !== "pros" && (
            <div className="series-banner">
              <Button variant="outline" onClick={() => setSelectedSeries(null)}>
                <ArrowLeft /> All productions
              </Button>
              <p>
                {selectedSeries.assets?.length || 0} saved references · Shared
                across future episodes
              </p>
              <Button
                disabled={busy}
                onClick={() => newEpisode(selectedSeries)}
              >
                <Plus /> New episode
              </Button>
            </div>
          )}
          <div className="category-strip" aria-label="Filter by category">
            {["All", ...CATEGORIES].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                className={category === c ? "selected" : ""}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="cinema-empty" role="status">
              <Loader2 className="spin" /> Loading your library…
            </div>
          ) : (
            <>
              <TabsContent value="pros"><Pros category={category} query={query}/></TabsContent>
              <TabsContent value="watch">
                {featured ? (
                  <>
                    <section className="screening-feature">
                      <div className="feature-art">
                        <Poster production={featured} hero />
                      </div>
                      <div className="feature-copy">
                        <span className="cinema-kicker">READY TO WATCH</span>
                        <h2>{featured.title.replaceAll("_", " ")}</h2>
                        <div className="video-meta">
                          <span>{featured.category}</span>
                          <span>
                            {featured.clipCount / 2 || featured.targetMinutes}{" "}
                            min
                          </span>
                          <span>{featured.resolution || "720p"}</span>
                        </div>
                        <p>Your script, brought to the screen. Take a seat.</p>
                        <div className="feature-actions">
                          <Button onClick={() => setPlaying(featured)}>
                            <Play fill="currentColor" /> Watch now
                          </Button>
                          <Button variant="outline" asChild>
                            <a href={`/?project=${featured.id}`}>
                              Open production <ArrowUpRight size={17} />
                            </a>
                          </Button>
                        </div>
                      </div>
                    </section>
                    {groups.map((g: any) => (
                      <section className="film-shelf" key={g.name}>
                        <div className="shelf-heading">
                          <h2>{g.name}</h2>
                          <span>
                            {g.items.length}{" "}
                            {g.items.length === 1 ? "title" : "titles"}
                          </span>
                        </div>
                        <div className="film-grid">
                          {g.items.map((p: Production) => (
                            <article className="film-card" key={p.id}>
                              <button
                                className="film-poster"
                                onClick={() => setPlaying(p)}
                                aria-label={`Watch ${p.title}`}
                              >
                                <Poster production={p} />
                                <span className="poster-play">
                                  <Play fill="currentColor" />
                                </span>
                                <span className="runtime-tag">
                                  {p.clipCount / 2 || p.targetMinutes} min
                                </span>
                              </button>
                              <h3>{p.title.replaceAll("_", " ")}</h3>
                              <div className="film-card-meta">
                                <span>
                                  {series.find((s) => s.id === p.seriesId)
                                    ?.name || p.category}
                                </span>
                                <ProductionTitleEditor id={p.id} title={p.title} onSaved={title => renamed(p.id, title)} />
                                <button onClick={() => organize(p)}>
                                  Organize
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </>
                ) : (
                  <div className="cinema-empty">
                    <Film size={44} />
                    <h2>
                      {productions.length
                        ? "No finished videos in this view yet."
                        : "Your first screening starts with a script."}
                    </h2>
                    <p>
                      {productions.length
                        ? "Completed productions appear here automatically. Find drafts and work in progress under Productions."
                        : "Create a production, build its world, and return here to watch the finished video."}
                    </p>
                    <Button onClick={() => setView("productions")}>
                      View productions
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="productions">
                {!selectedSeries && (
                  <section className="series-shelf">
                    <div className="shelf-heading">
                      <h2>Series & recurring projects</h2>
                      <span>One world. More stories.</span>
                    </div>
                    {series.length ? (
                      <div className="series-grid">
                        {series.map((s) => (
                          <button
                            key={s.id}
                            className="series-card"
                            disabled={busy}
                            onClick={() => openSeries(s)}
                          >
                            <Layers />
                            <strong>{s.name}</strong>
                            <span>
                              {s.category} · {s.episodeCount} productions
                            </span>
                            <small>
                              {s.referenceCount} saved references{" "}
                              <ArrowUpRight size={16} />
                            </small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="series-intro">
                        <Layers />
                        <p>
                          Keep characters, locations and props consistent across
                          episodes, campaigns or recurring videos.
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => setCreateOpen(true)}
                        >
                          Create your first series
                        </Button>
                      </div>
                    )}
                  </section>
                )}
                <div className="shelf-heading">
                  <h2>
                    {selectedSeries
                      ? "Episodes & productions"
                      : "All productions"}
                  </h2>
                  <span>
                    {visible.length}{" "}
                    {visible.length === 1 ? "production" : "productions"}
                  </span>
                </div>
                <div className="production-rows">
                  {visible.map((p) => (
                    <article className="production-row" key={p.id}>
                      <div className="row-poster">
                        <Poster production={p} />
                      </div>
                      <div className="production-row-title">
                        <h3>{p.title.replaceAll("_", " ")}</h3>
                        <p>
                          {p.category}
                          {p.seriesId
                            ? ` · ${series.find((s) => s.id === p.seriesId)?.name || "Series"}`
                            : ""}
                        </p>
                        <span
                          className={`production-status status-${p.status}`}
                        >
                          {p.status}
                        </span>
                      </div>
                      <div className="production-row-actions">
                        {p.outputKey && p.status === "complete" && (
                          <Button
                            onClick={() => setPlaying(p)}
                            aria-label={`Watch ${p.title}`}
                          >
                            <Play /> Watch
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => organize(p)}
                        >
                          Organize
                        </Button>
                        <ProductionTitleEditor id={p.id} title={p.title} onSaved={title => renamed(p.id, title)} />
                        <Button variant="ghost" asChild>
                          <a href={`/?project=${p.id}`}>
                            Open <ArrowUpRight size={16} />
                          </a>
                        </Button>
                        {selectedSeries &&
                          ["ready", "complete"].includes(p.status) && (
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await api("adoptReferences", { id: p.id });
                                  const r = await api("series", {
                                    seriesId: selectedSeries.id,
                                  });
                                  setSelectedSeries(r.series);
                                  await refresh();
                                  setNotice(
                                    "This episode’s references are now the defaults for future episodes. Existing productions keep their saved references.",
                                  );
                                })
                              }
                            >
                              Use references for future episodes
                            </Button>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
                {!visible.length && (
                  <div className="cinema-empty">
                    <FolderOpen />
                    <h2>No productions here yet.</h2>
                    <p>
                      {selectedSeries
                        ? "Add the next script to this series to reuse its saved world."
                        : "Try another category or create your first production."}
                    </p>
                    {selectedSeries && (
                      <Button
                        disabled={busy}
                        onClick={() => newEpisode(selectedSeries)}
                      >
                        <Plus /> New episode
                      </Button>
                    )}
                  </div>
                )}
                {selectedSeries && (
                  <section className="series-references">
                    <div className="shelf-heading">
                      <h2>Shared reference library</h2>
                      <span>
                        {selectedSeries.assets?.length || 0} references
                      </span>
                    </div>
                    <p>
                      References are saved automatically as episodes prepare.
                      New scripts reuse these images and the visual guide.
                      Changes within an episode stay local unless you choose
                      “Use references for future episodes”.
                    </p>
                    <div className="reference-library-grid">
                      {selectedSeries.assets?.map((a) => (
                        <article key={a.id}>
                          <img
                            src={media(a.imageKey)}
                            alt={a.name}
                            loading="lazy"
                          />
                          <div>
                            <span>{a.kind}</span>
                            <h3>{a.name}</h3>
                            <p>{a.description}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                    {!selectedSeries.assets?.length && (
                      <p className="reference-empty">
                        Create an episode or move a prepared production into
                        this series. Its references will be saved here.
                      </p>
                    )}
                    {selectedSeries.productionBible && (
                      <details className="series-bible">
                        <summary>Visual continuity guide</summary>
                        <p>{selectedSeries.productionBible}</p>
                      </details>
                    )}
                  </section>
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
        <footer className="cinema-footer">
          <span>THE BIG SLOP</span>
          <p>Big ideas. Questionable cinema. Yours to make.</p>
          <a href="/">
            Back to the studio <ArrowUpRight size={15} />
          </a>
        </footer>
      </main>
      <Dialog
        open={!!playing}
        onOpenChange={(open) => {
          if (!open) setPlaying(null);
        }}
      >
        <DialogContent className="screening-player">
          <DialogTitle>{playing?.title.replaceAll("_", " ")}</DialogTitle>
          <DialogDescription>
            {playing?.category} ·{" "}
            {playing?.clipCount
              ? playing.clipCount / 2
              : playing?.targetMinutes}{" "}
            min · {playing?.resolution || "720p"}
          </DialogDescription>
          {playing?.outputKey && (
            <video
              key={`${playing.id}-${playbackAttempt}`}
              onError={() => setPlayerError(true)}
              controls
              autoPlay
              playsInline
              preload="metadata"
              src={media(playing.outputKey)}
              poster={playing.posterKey ? media(playing.posterKey) : undefined}
            />
          )}
          {playerError && (
            <p role="alert">
              The video could not load.{" "}
              <button
                onClick={() => {
                  setPlayerError(false);
                  setPlaybackAttempt((v) => v + 1);
                }}
              >
                Retry playback
              </button>
            </p>
          )}
          <div className="player-actions">
            <Button variant="outline" asChild>
              <a href={`/?project=${playing?.id}`}>Open production</a>
            </Button>
            {next && (
              <Button onClick={() => setPlaying(next)}>
                Next episode <Play />
              </Button>
            )}
          </div>
          {episodes.length > 1 && (
            <div className="episode-picker" aria-label="Episodes">
              {episodes.map((p, i) => (
                <button
                  key={p.id}
                  aria-current={playing?.id === p.id ? "true" : undefined}
                  onClick={() => setPlaying(p)}
                >
                  {i + 1}. {p.title.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!organizing}
        onOpenChange={(open) => {
          if (!open && !busy) setOrganizing(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Organize production</DialogTitle>
          <DialogDescription>
            {organizing?.title}. Changing its category does not regenerate the
            video.
          </DialogDescription>
          <label className="library-field">
            Category
            <CategorySelect value={moveCategory} onChange={setMoveCategory} />
          </label>
          <label className="library-field">
            Series / recurring project
            <Select
              value={moveSeries}
              onValueChange={setMoveSeries}
              disabled={
                !!organizing &&
                !["draft", "ready", "complete"].includes(organizing.status)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Standalone production</SelectItem>
                {series.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <p className="library-dialog-note">
            Moving a prepared production into a series saves its references for
            future episodes. Existing shared identities are preserved.
          </p>
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("organize", {
                  id: organizing!.id,
                  category: moveCategory,
                  seriesId: moveSeries === "none" ? null : moveSeries,
                });
                await refresh();
                if (selectedSeries) {
                  const r = await api("series", {
                    seriesId: selectedSeries.id,
                  });
                  setSelectedSeries(r.series);
                }
                setOrganizing(null);
                setNotice("Production organization saved.");
              })
            }
          >
            {busy ? <Loader2 className="spin" /> : <FolderOpen />} Save changes
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!busy) setCreateOpen(open);
        }}
      >
        <DialogContent>
          <DialogTitle>Create a series</DialogTitle>
          <DialogDescription>
            A shared home for recurring characters, locations, props and a
            visual continuity guide. Any category can be a series.
          </DialogDescription>
          <label className="library-field">
            Series name
            <Input
              placeholder="e.g. The Regulars"
              maxLength={120}
              value={seriesName}
              onChange={(e) => setSeriesName(e.target.value)}
            />
          </label>
          <label className="library-field">
            Category
            <CategorySelect
              value={seriesCategory}
              onChange={setSeriesCategory}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={busy || !seriesName.trim()}
            onClick={() =>
              run(async () => {
                const r = await api("createSeries", {
                  name: seriesName,
                  category: seriesCategory,
                });
                await refresh();
                setCreateOpen(false);
                setSeriesName("");
                setSelectedSeries(r.series);
                setView("productions");
                setCategory("All");
                setQuery("");
              })
            }
          >
            {busy ? <Loader2 className="spin" /> : <Plus />} Create series
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
