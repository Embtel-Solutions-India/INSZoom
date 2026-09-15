import { useQuery } from "@tanstack/react-query";
import { casesApi, profileApi } from "../services/api";

// Shared cache for the two fetches duplicated across Documents/Dashboard/
// Messages/PlanSelection/Profile — same request functions as before
// (services/api.js), just deduplicated/cached across page navigations
// instead of every page refetching from scratch.
export function useMyCase(options = {}) {
  return useQuery({ queryKey: ["case", "my"], queryFn: casesApi.my, ...options });
}

export function useMyProfile(options = {}) {
  return useQuery({ queryKey: ["profile", "me"], queryFn: profileApi.get, ...options });
}
