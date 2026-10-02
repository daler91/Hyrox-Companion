import type {
  AthleteFact,
  AthleteFactImportResult,
  CreateAthleteFact,
  UpdateAthleteFact,
} from "@shared/schema";

import { typedRequest } from "./client";

const factUrl = (id: string) => `/api/v1/athlete-facts/${encodeURIComponent(id)}`;

/**
 * The athlete card (coach-memory spec, Path C): what the athlete told the
 * coach is true every week. Request and response shapes come from
 * @shared/schema so they can't drift from the server's.
 */
export const athleteFacts = {
  /** Every fact, retired ones included, oldest first. */
  list: () => typedRequest<AthleteFact[]>("GET", "/api/v1/athlete-facts"),

  /** Adds a fact, or re-confirms one the card already holds. */
  create: (data: CreateAthleteFact) => typedRequest<AthleteFact>("POST", "/api/v1/athlete-facts", data),

  update: (id: string, data: UpdateAthleteFact) => typedRequest<AthleteFact>("PATCH", factUrl(id), data),

  remove: (id: string) => typedRequest<{ success: boolean }>("DELETE", factUrl(id)),

  /** Moves the older free-text note onto the card, a fact per sentence. */
  importNote: () => typedRequest<AthleteFactImportResult>("POST", "/api/v1/athlete-facts/import", {}),
} as const;
