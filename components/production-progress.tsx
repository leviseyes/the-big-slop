"use client";
import { useEffect, useState } from "react";
import { Loader2, Clock3, Check, Radio } from "lucide-react";
import {
  currentProgress,
  stageEstimates,
} from "@/services/production-workflow.mjs";
export const timeRange = (low: number, high: number) =>
  high < 60
    ? `${low}–${high} min`
    : `${(low / 60).toFixed(1)}–${(high / 60).toFixed(1)} hr`;
export function TimeEstimates({ project }: { project: any }) {
  return (
    <div className="time-estimates">
      <h3>Approximate production time</h3>
      <div className="time-grid">
        {stageEstimates(project).map((s) => (
          <div key={s.key}>
            <span>{s.label}</span>
            <b>
              {s.done >= s.total && s.total > 0
                ? "Done"
                : !s.total
                  ? "Known after planning"
                  : timeRange(
                      Math.ceil(Math.max(0, s.total - s.done) * s.unitLow),
                      Math.ceil(Math.max(0, s.total - s.done) * s.unitHigh),
                    )}
            </b>
          </div>
        ))}
      </div>
      <p>
        Planning ranges for the remaining work, not deadlines. Queueing,
        provider load and retries can add time. The render worker must stay awake
        and online.
      </p>
    </div>
  );
}
export function ProductionProgress({
  project,
  ready,
  workerActive,
  lastSynced,
}: {
  project: any;
  ready: any;
  workerActive?: boolean;
  lastSynced: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const step = currentProgress(project);
  const fresh = now - lastSynced < 20000;
  const connected =
    ready.worker &&
    (!ready.workerLastSeenAt || now - ready.workerLastSeenAt < 90000);
  const live = fresh && connected;
  const recovering = project.status === "queued" && project.transferRetry;
  const retrySeconds = Math.max(0, Math.ceil(((project.transferRetry?.after || now) - now) / 1000));
  const elapsed = Math.max(
    0,
    Math.floor(
      (now -
        (project.progress?.startedAt || project.preparationStartedAt || now)) /
        1000,
    ),
  );
  const percent = step.total
    ? Math.min(100, Math.round((step.done / step.total) * 100))
    : 0;
  return (
    <section
      className={`production-live ${live ? "" : "waiting"}`}
      role="status"
      aria-live="polite"
      aria-busy={live}
    >
      <div className="production-live-top">
        <span className="live-icon">
          {live ? <Loader2 className="spin" size={32} /> : <Clock3 size={32} />}
        </span>
        <div>
          <span className="live-eyebrow">
            {!fresh
              ? "Connection interrupted"
              : !connected
                ? "Waiting for render worker"
                : recovering
                  ? "Recovering automatically"
                : workerActive === false
                  ? "In the production queue"
                  : "Production in progress"}
          </span>
          <h2>{project.phase || step.label}</h2>
          <p>
            {!live
              ? "Progress is saved. We’ll reconnect automatically; keep the render worker online."
              : recovering
                ? `Your completed video is safe. ${retrySeconds > 0 ? `Retrying in ${retrySeconds}s.` : "Waiting for the worker to reconnect."} You don’t need to restart or approve another generation.`
              : workerActive === false
                ? "Your job is waiting for the worker. This page checks automatically."
                : "The crew is still working in the background. You can leave this page open or come back later."}
          </p>
        </div>
        <span className="live-signal">
          <Radio size={16} />
          {live ? "LIVE" : "WAITING"}
        </span>
      </div>
      <div className="live-counts">
        <b>
          {step.label}: {step.done} / {step.total || "…"} complete
        </b>
        <span>
          {step.remainingHigh > 0
            ? `About ${timeRange(step.remainingLow, step.remainingHigh)} remaining in this step`
            : "Finishing this step…"}
        </span>
      </div>
      <div
        className="live-track"
        role="progressbar"
        aria-label={`${step.label} completed`}
        aria-valuemin={0}
        aria-valuemax={step.total || 1}
        aria-valuenow={step.done}
      >
        <div style={{ width: `${percent}%` }} />
        {live && <span className="live-sweep" />}
      </div>
      <div className="live-footer">
        <span aria-live="off">
          {project.progress?.startedAt ? "Elapsed in this step" : "Production elapsed"}: {Math.floor(elapsed / 60)}m {elapsed % 60}s
        </span>
        <span aria-live="off">
          Last sync {Math.max(0, Math.floor((now - lastSynced) / 1000))}s ago
        </span>
      </div>
      <div className="live-stages">
        {stageEstimates(project).map((s) => (
          <span key={s.key} className={s.key === step.key ? "active" : ""}>
            {s.total > 0 && s.done >= s.total ? (
              <Check size={14} />
            ) : s.key === step.key && live ? (
              <Loader2 className="spin" size={14} />
            ) : (
              <Clock3 size={14} />
            )}{" "}
            {s.label}
          </span>
        ))}
      </div>
    </section>
  );
}
