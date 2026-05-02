import type { Job } from "pg-boss";

export function getJobData<T extends Record<string, unknown>>(job: Job): T {
  return job.data as T;
}

export function hasIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
