export const IMAGE_REPARSE_TIMEOUT_MS = 60_000;

export interface ReparseResponse {
  exercises: unknown[];
  saved: boolean;
  setCount?: number;
}
