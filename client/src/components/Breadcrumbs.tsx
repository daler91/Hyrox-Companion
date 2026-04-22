import type { TimelineEntry } from "@shared/schema";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useReducer } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { QUERY_KEYS } from "@/lib/api";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Home",
  "/log": "Log Workout",
  "/analytics": "Analytics",
  "/settings": "Settings",
  "/privacy": "Privacy Policy",
};

const WORKOUT_LABEL_MAX_CHARS = 40;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function entryLabel(entry: TimelineEntry): string {
  return truncate(entry.focus || entry.mainWorkout || "Workout", WORKOUT_LABEL_MAX_CHARS);
}

function findEntryInTimelineCache(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
): TimelineEntry | undefined {
  // Scan every cached timeline variant (the key is prefixed with
  // QUERY_KEYS.timeline; each user-selected plan produces its own entry).
  const variants = queryClient.getQueriesData<TimelineEntry[]>({
    queryKey: QUERY_KEYS.timeline,
  });
  for (const [, data] of variants) {
    if (!data) continue;
    const hit = data.find(
      (entry) => entry.workoutLogId === id || entry.planDayId === id,
    );
    if (hit) return hit;
  }
  return undefined;
}

function WorkoutBreadcrumbLabel({ id, fallback }: Readonly<{ id: string; fallback: string }>) {
  const queryClient = useQueryClient();
  // Re-render when any timeline variant's cache updates so the label appears
  // once Timeline populates it (e.g. on a `/?workout=<id>` deep link).
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const [timelinePrefix] = QUERY_KEYS.timeline;
    return cache.subscribe((event) => {
      const queryKey = event.query.queryKey as readonly unknown[];
      if (queryKey[0] === timelinePrefix) {
        forceRender();
      }
    });
  }, [queryClient]);

  const match = findEntryInTimelineCache(queryClient, id);
  return <>{match ? entryLabel(match) : fallback}</>;
}

export function Breadcrumbs() {
  const [pathname] = useLocation();
  const search = useSearch();
  const workoutId = new URLSearchParams(search).get("workout");

  const currentLabel = ROUTE_LABELS[pathname];
  const isHome = pathname === "/";

  // No trail when we have nothing to show beyond "Home".
  if (!currentLabel) return null;
  if (isHome && !workoutId) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="px-4 py-2 border-b bg-background/60"
      data-testid="breadcrumbs"
    >
      <ol className="flex items-center gap-1 text-sm text-muted-foreground">
        <li>
          <Link
            href="/"
            className="hover:text-foreground transition-colors"
            data-testid="breadcrumb-home"
          >
            Home
          </Link>
        </li>
        <li aria-hidden="true" className="flex items-center">
          <ChevronRight className="h-4 w-4" />
        </li>
        <li>
          <span
            aria-current="page"
            className="text-foreground font-medium"
            data-testid="breadcrumb-current"
          >
            {isHome && workoutId ? (
              <WorkoutBreadcrumbLabel id={workoutId} fallback="Workout" />
            ) : (
              currentLabel
            )}
          </span>
        </li>
      </ol>
    </nav>
  );
}
