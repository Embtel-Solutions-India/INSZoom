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
          <div className="bg-card rounded-lg border border-card-border divide-y divide-border overflow-hidden">
            {milestones.map((m) => (
              <div key={m.key} className="flex items-center gap-3 px-5 py-4">
                <span className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors
                  ${m.completed ? "bg-primary border-primary text-primary-foreground" : "border-border text-transparent"}`}>
                  {m.completed && <Ic.Check />}
                </span>
                <span className={`text-sm font-medium transition-colors ${m.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
