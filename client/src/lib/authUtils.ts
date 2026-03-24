export function isUnauthorizedError(error: Error): boolean {
  return error.message === "Unauthorized" || error.message.includes("401");
}
