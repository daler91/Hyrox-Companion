/**
 * The Firebase service account the server sends native push with, parsed from
 * FCM_SERVICE_ACCOUNT_JSON (the key file Firebase console → Project settings →
 * Service accounts generates, pasted whole).
 *
 * Kept free of imports so server/env.ts can validate the variable at boot with
 * the same parser server/fcm.ts uses to send.
 */
export interface FcmServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** The parsed account, or null when the value is missing or not a usable key file. */
export function parseFcmServiceAccount(value: string | undefined): FcmServiceAccount | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const projectId = record.project_id;
  const clientEmail = record.client_email;
  const privateKey = record.private_key;
  if (
    typeof projectId !== "string" ||
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) ||
    typeof clientEmail !== "string" ||
    !clientEmail.includes("@") ||
    typeof privateKey !== "string" ||
    !privateKey.includes("PRIVATE KEY")
  ) {
    return null;
  }
  return { projectId, clientEmail, privateKey };
}
