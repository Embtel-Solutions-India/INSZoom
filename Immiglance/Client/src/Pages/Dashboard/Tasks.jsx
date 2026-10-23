import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMyCase } from "../../hooks/useMyCaseProfile";
import { casesApi } from "../../services/api";

const Ic = {
  Check: () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>,
};

function TasksSkeleton() {
  return (
    <div className="bg-card rounded-lg border border-card-border p-6 animate-pulse" aria-hidden="true">
      <div className="h-4 w-40 bg-secondary rounded mb-4" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}
      </div>
    </div>
  );
}

// The client-facing case-lifecycle checklist — reads the same live,
// DB-driven milestone list GET /cases/:id/workflow already returns
// (case-lifecycle-orchestrator.service.js's MILESTONE_DEFINITIONS), the
// same source Dashboard.jsx's "workflow" query already fetches. Never
// hardcode a second copy of this list here — a milestone flips to
// `completed` the moment the real case state changes, so this page is
// always consistent with the actual case, not a static mock.
// Vertical version of the dashboard's progress bar: one row per task, a line joining them that fills (with a short animation) from the first task
// down to the task the case is at now. Done tasks are solid, the current one is ringed, the rest are empty.
const ROW_HEIGHT = 72; // px; every row has the same height so the line can be placed by simple proportion
function TaskTimeline({ milestones }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const firstOpen = milestones.findIndex((milestone) => !milestone.completed);
  const currentIndex = firstOpen === -1 ? milestones.length - 1 : firstOpen;
  const span = Math.max(1, milestones.length - 1);
  const fillRatio = milestones.length > 1 ? currentIndex / span : 0;
  return (
    <div className="relative overflow-hidden rounded-lg border border-card-border bg-card">
      {milestones.length > 1 && (
        <>
          <span aria-hidden="true" className="absolute left-[35px] w-0.5 -translate-x-1/2 bg-border" style={{ top: ROW_HEIGHT / 2, bottom: ROW_HEIGHT / 2 }} />
          <span
            aria-hidden="true"
            className="absolute left-[35px] w-0.5 -translate-x-1/2 bg-primary transition-[height] duration-1000 ease-out"
            style={{ top: ROW_HEIGHT / 2, height: filled ? `calc((100% - ${ROW_HEIGHT}px) * ${fillRatio})` : 0 }}
          />
        </>
      )}
      <ol>
        {milestones.map((milestone, index) => {
          const done = Boolean(milestone.completed);
          const active = index === currentIndex && !done;
          return (
            <li key={milestone.key} className="relative flex items-center gap-4 px-6" style={{ height: ROW_HEIGHT }}>
              <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-card transition-colors duration-500 ${done ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary ring-4 ring-primary/15" : "border-border"}`}>
                {done ? <Ic.Check /> : active ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${done ? "font-medium text-muted-foreground" : active ? "font-semibold text-foreground" : "text-foreground"}`}>{milestone.label}</p>
                <p className="text-xs text-muted-foreground">{done ? "Completed" : active ? "In progress" : "Pending"}</p>
              </div>
              {active && <span className="hidden shrink-0 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary sm:inline">Current</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Tasks() {
  const { data: rawCase, isPending: caseIsPending } = useMyCase();
  const caseData = rawCase?.case || rawCase?.data?.case || rawCase;
  const caseId = caseData?._id;

  const { data: workflowRaw, isPending: workflowIsPending } = useQuery({
    queryKey: ["case", "workflow", caseId],
    queryFn: () => casesApi.workflow(caseId),
    enabled: Boolean(caseId),
  });
  const milestones = workflowRaw?.workflow?.progress?.milestones || workflowRaw?.data?.progress?.milestones || [];
  const completedCount = milestones.filter((m) => m.completed).length;
  const isLoading = caseIsPending || (Boolean(caseId) && workflowIsPending);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-2">
        <h1 className="font-serif text-2xl font-bold text-foreground">Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {milestones.length ? `${completedCount} of ${milestones.length} completed` : "Your case's step-by-step progress."}
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7">
        {isLoading ? (
          <TasksSkeleton />
        ) : !caseId ? (
          <div className="bg-card rounded-lg border border-card-border p-6 text-center">
            <p className="text-sm text-muted-foreground">Tasks appear once your case has been created.</p>
          </div>
        ) : (
          <TaskTimeline milestones={milestones} />
        )}
      </div>
    </div>
  );
}
