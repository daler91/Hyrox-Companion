export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  FORBIDDEN = "FORBIDDEN",
  UNAUTHORIZED = "UNAUTHORIZED",
  CONFLICT = "CONFLICT",
  RATE_LIMITED = "RATE_LIMITED",
  AI_TIMEOUT = "AI_TIMEOUT",
  AI_ERROR = "AI_ERROR",
  EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
