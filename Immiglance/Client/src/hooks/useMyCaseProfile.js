import { useQuery } from "@tanstack/react-query";
import { casesApi, profileApi } from "../services/api";
import { useActiveCase } from "../context/ActiveCaseContext";

// Shared cache for the two fetches duplicated across Documents/Dashboard/
// Messages/PlanSelection/Profile — same request functions as before
// (services/api.js), just deduplicated/cached across page navigations
// instead of every page refetching from scratch.
export function useMyCase(options = {}) {
  // keyed by the open case (one login, many cases); "default" for a one-case client - the same single request as before
  const { activeCaseId } = useActiveCase();
  return useQuery({ queryKey: ["case", "my", activeCaseId || "default"], queryFn: casesApi.my, ...options });
}

export function useMyProfile(options = {}) {
  return useQuery({ queryKey: ["profile", "me"], queryFn: profileApi.get, ...options });
}
