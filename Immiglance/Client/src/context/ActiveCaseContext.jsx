import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";
import { activeCaseStore, casesApi } from "../services/api";

// One login, many cases (docs/MULTI_CASE_CLIENTS_PLAN.md, Phase 2A). Knows every case of the signed-in person and which one is open.
//   - one case (or none, or the list could not load): nothing is selected and nothing changes anywhere - every page works exactly as before
//   - two or more: the open case comes from ?case= in the address, else the one last opened in this browser tab, else the person's default case;
//     switching re-reads every page for the new case (PortalLayout remounts the page) and nothing from the previous case is shown
// The server checks every request against the person's own cases, so a stale or foreign id simply falls back to the default case.
const ActiveCaseContext = createContext({ cases: [], activeCaseId: null, activeCase: null, multiCase: false, selectCase: () => {} });

const storageKey = (userId) => `immiglance.activeCase.${userId}`;
const readStored = (userId) => { try { return sessionStorage.getItem(storageKey(userId)) || ""; } catch { return ""; } };
const writeStored = (userId, id) => { try { sessionStorage.setItem(storageKey(userId), id); } catch { /* only a convenience */ } };
const fromAddress = () => { try { return new URLSearchParams(window.location.search).get("case") || ""; } catch { return ""; } };

export function ActiveCaseProvider({ children }) {
  const { user, authStatus } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?._id || user?.id || "";
  // 2A: client-side logins (client / employer / petitioner). Employee / beneficiary logins keep their single-case view until Phase 2B.
  const eligible = authStatus === "authenticated" && Boolean(userId) && !["employee", "beneficiary"].includes(user?.role);

  const { data } = useQuery({
    queryKey: ["cases", "mine", userId],
    queryFn: casesApi.mine,
    enabled: eligible,
    staleTime: 60 * 1000,
    retry: 1,
  });
  const cases = useMemo(() => (Array.isArray(data?.data?.cases) ? data.data.cases : []), [data]);
  const defaultCaseId = data?.data?.defaultCaseId || "";
  const multiCase = eligible && cases.length > 1;

  const [chosenId, setChosenId] = useState("");
  // pick the open case once the list is known (address -> this tab -> default); only ever an id from the person's own list
  useEffect(() => {
    if (!multiCase) { setChosenId(""); return; }
    const known = new Set(cases.map((row) => row._id));
    const pick = [fromAddress(), readStored(userId), defaultCaseId].find((id) => id && known.has(id)) || cases[cases.length - 1]._id;
    setChosenId((current) => (current && known.has(current) ? current : pick));
  }, [multiCase, cases, defaultCaseId, userId]);

  const activeCase = multiCase ? cases.find((row) => row._id === chosenId) || null : null;
  const activeCaseId = activeCase?._id || null;

  // the API client adds ?caseId= to the "my case" requests only while a case is selected (never for a one-case person)
  activeCaseStore.set(activeCase ? { id: activeCase._id, capacity: activeCase.capacity } : null);
  useEffect(() => () => activeCaseStore.set(null), []);

  const selectCase = useCallback((id) => {
    if (!id || id === activeCaseId || !cases.some((row) => row._id === id)) return;
    const row = cases.find((item) => item._id === id);
    activeCaseStore.set({ id: row._id, capacity: row.capacity });
    writeStored(userId, id);
    setChosenId(id);
    // nothing cached from the previous case may show for the new one
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "cases" || query.queryKey[1] !== "mine" });
  }, [activeCaseId, cases, queryClient, userId]);

  const value = useMemo(() => ({ cases, activeCaseId, activeCase, multiCase, selectCase }), [cases, activeCaseId, activeCase, multiCase, selectCase]);
  return <ActiveCaseContext.Provider value={value}>{children}</ActiveCaseContext.Provider>;
}

export const useActiveCase = () => useContext(ActiveCaseContext);
