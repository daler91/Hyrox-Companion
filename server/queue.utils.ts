import type { Job } from "pg-boss";

export function getJobData<T extends Record<string, unknown>>(job: Job): T {
  return job.data as T;
}

export function hasIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function getUserIdFromJob(job: Job): string | null {
  const { userId } = getJobData<{ userId?: unknown }>(job);
  return hasIdentifier(userId) ? userId : null;
}

export function getEmbedJobIdentifiers(job: Job): { materialId: string; userId: string } | null {
  const { materialId, userId } = getJobData<{ materialId?: unknown; userId?: unknown }>(job);
  if (!hasIdentifier(materialId) || !hasIdentifier(userId)) return null;
  return { materialId, userId };
}
