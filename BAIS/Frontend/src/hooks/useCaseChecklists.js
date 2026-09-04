import { useQuery } from "@tanstack/react-query";
import { questionnairesApi } from "../services/api";

// Every checklist currently assigned to a case (any visa type, any role) —
// thin wrapper around listCaseChecklists, which is already generic
// (Case.questionnaireReferences, populated by assignQuestionnaire/the
// checklist-rule-engine for any visa type, not hardcoded per visa). This is
// what CaseChecklistPanel uses to build one tab per assigned checklistRole
// instead of a caller hardcoding which roles to check for.
export default function useCaseChecklists(caseId) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["checklists", "case", caseId],
    queryFn: async () => {
      const response = await questionnairesApi.listCaseChecklists(caseId);
      return response.data?.checklists || [];
    },
    enabled: Boolean(caseId),
    staleTime: 2 * 60_000,
  });

  return { checklists: caseId ? data || [] : [], loading: Boolean(caseId) && isLoading, refetch };
}
