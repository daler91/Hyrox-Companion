import { QUERY_KEYS } from "@/lib/api";

/**
 * The reads built from logged food that span days or a session's window rather
 * than one date: the Timeline fuel chips, the Analytics -> Fuelling block and a
 * workout's pre/post intake (useSessionFuelling). Every food-log write
 * refreshes them, online (useNutrition) and on offline replay
 * (offlineInvalidation), from this one list. The two kept their own copies,
 * and of these reads each refreshed only the Timeline chips: the block and a
 * session's intake kept their old figures for their staleTime.
 * CL19 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const FOOD_LOG_MULTI_DAY_QUERY_KEYS = [
  QUERY_KEYS.nutritionRangePrefix,
  QUERY_KEYS.nutritionBlockPrefix,
  QUERY_KEYS.nutritionSessionFuellingPrefix,
] as const;

/**
 * Every read built from logged food, on any day: what an offline replay
 * refreshes (the queue doesn't know which days its writes touched), and what a
 * custom food or recipe edit refreshes (its logged entries read it live,
 * whatever day they fall on). CL19 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const FOOD_LOG_ALL_DAYS_QUERY_KEYS = [
  QUERY_KEYS.nutritionDayPrefix,
  QUERY_KEYS.nutritionMicrosPrefix,
  ...FOOD_LOG_MULTI_DAY_QUERY_KEYS,
] as const;
