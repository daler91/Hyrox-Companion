import type { ConsentType } from "@shared/schema";

import { typedRequest } from "./client";

/**
 * Best-effort server-side consent record (W4). localStorage remains the source
 * of truth for the client-side gate; this adds an auditable trail for
 * authenticated users (GDPR Art. 7 / CCPA). Errors are swallowed on purpose:
 * an unauthenticated visitor 401s and a transient network failure must never
 * block dismissing the banner — the localStorage record already captured it.
 */
export async function recordServerConsent(
  consentType: ConsentType,
  granted: boolean,
): Promise<void> {
  try {
    await typedRequest("POST", "/api/v1/consents", { consentType, granted });
  } catch {
    // Intentionally ignored — see above.
  }
}
