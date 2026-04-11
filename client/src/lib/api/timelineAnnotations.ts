import type {
  InsertTimelineAnnotation,
  TimelineAnnotation,
  UpdateTimelineAnnotation,
} from "@shared/schema";

import { typedRequest } from "./client";

/**
 * CRUD surface for user-authored timeline annotations (injury, illness,
 * travel, rest). Mirrors the server-side types in @shared/schema so the
 * request/response shapes can't drift between layers.
 */
export const timelineAnnotations = {
  list: () =>
    typedRequest<TimelineAnnotation[]>("GET", "/api/v1/timeline-annotations"),

  create: (data: InsertTimelineAnnotation) =>
    typedRequest<TimelineAnnotation>("POST", "/api/v1/timeline-annotations", data),

  update: (id: string, data: UpdateTimelineAnnotation) =>
    typedRequest<TimelineAnnotation>("PATCH", `/api/v1/timeline-annotations/${id}`, data),

  delete: (id: string) =>
    typedRequest<{ success: boolean }>("DELETE", `/api/v1/timeline-annotations/${id}`),
} as const;
