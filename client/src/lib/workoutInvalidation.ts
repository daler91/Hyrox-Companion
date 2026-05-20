import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

export function invalidateWorkoutWriteQueries(): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(() => {});
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(() => {});
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(() => {});
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
}
