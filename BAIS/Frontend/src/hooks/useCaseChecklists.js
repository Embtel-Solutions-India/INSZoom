import { useCallback, useEffect, useState } from "react";
import { questionnairesApi } from "../services/api";

// Every checklist currently assigned to a case (any visa type, any role) —
// thin wrapper around listCaseChecklists, which is already generic
// (Case.questionnaireReferences, populated by assignQuestionnaire/the
// checklist-rule-engine for any visa type, not hardcoded per visa). This is
// what CaseChecklistPanel uses to build one tab per assigned checklistRole
// instead of a caller hardcoding which roles to check for.
export default function useCaseChecklists(caseId) {
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!caseId) {
      setChecklists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await questionnairesApi.listCaseChecklists(caseId);
      setChecklists(response.data?.checklists || []);
    } catch {
      setChecklists([]);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  return { checklists, loading, refetch: load };
}
