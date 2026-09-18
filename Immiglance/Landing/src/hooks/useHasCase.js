import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { casesApi } from "../services/api";
import { isEmployeeAccount } from "../utils/auth";

// Single source of truth for "does this logged-in user already have a
// case" — gates the public eligibility quiz's CTAs (StartAssessmentButton)
// and its route (/eligibility, /eligibility/quiz) so an existing client
// can't retake the quiz and spawn a duplicate lead/assessment. Anonymous
// visitors and logged-in users without a case must see hasCase: false — the
// acquisition funnel stays on for them. An invited employee always counts
// as "has a case" (their whole world is their own case's checklist; they
// should never see the quiz either), without an extra network round trip.
//
// casesApi.my() (GET /cases/my) resolves to a single case object or `null`
// — not an array — so "has a case" is `Boolean(data?._id)`, not a length
// check. Cached per-user (queryKey includes userId) so every CTA placement
// on a page shares one fetch instead of one each.
export default function useHasCase() {
  const { user, authLoading } = useAuth();
  const userId = user?._id || user?.id;
  const employee = isEmployeeAccount(user);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["hasCase", userId],
    queryFn: () => casesApi.my(),
    enabled: Boolean(userId) && !employee,
    staleTime: 5 * 60 * 1000,
  });

  if (authLoading) return { hasCase: false, loading: true, isError: false };
  if (!userId) return { hasCase: false, loading: false, isError: false };
  if (employee) return { hasCase: true, loading: false, isError: false };
  // isError was previously indistinguishable from "confirmed, no case" here
  // (React Query leaves `data` undefined on error same as while loading) —
  // a transient failure fetching /cases/my would silently look identical to
  // a brand-new client with no case yet to every consumer of this hook.
  return { hasCase: Boolean(data && (data._id || data.id)), loading: isLoading, isError };
}
