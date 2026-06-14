import { env } from "../../env";
import { logger } from "../../logger";
import { deleteRuntimeCache, getRuntimeCache, setRuntimeCache } from "../../sharedRuntimeState";
import { parseRetryAfter, RetryableHttpError, retryWithJitter } from "../../utils/httpRetry";
import { MICRO_DEFS } from "./micros";
import type { MappedFood } from "./types";

/**
 * FatSecret Platform API client. The verified, frequently-updated source for
 * branded foods and barcodes, normalized to the same PER-100-GRAM basis as the
 * USDA/OFF clients so it caches into `foods` through the identical path. This is
 * the one place FatSecret's OAuth2 handshake and response shape are interpreted.
 *
 * Auth is OAuth2 client-credentials (server-to-server): client id + secret → a
 * short-lived Bearer token, cached in-process and shared across replicas via
 * `server_runtime_cache`. Like the other clients, every failure mode (no
 * credentials, a non-whitelisted egress IP, a provider hiccup, an unknown
 * barcode) degrades to an empty result rather than throwing, so search/barcode
 * always fall back cleanly to USDA/Open Food Facts.
 *
 * The AI architecture rule (BRD §7) does not apply — these are real, verified
 * numbers from FatSecret, not generated values.
 */

const FATSECRET_TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const FATSECRET_API_URL = "https://platform.fatsecret.com/rest/server.api";
const FATSECRET_TIMEOUT_MS = 8_000;
const FATSECRET_MAX_RESULTS = 25;
// Matches usdaClient.ts exactly so an oz serving converts identically everywhere.
const OZ_TO_GRAMS = 28.349523125;

const TOKEN_CACHE_KEY = "fatsecret:token";
// Refresh a minute before the real expiry so an in-flight call never races it.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

// Process-local fast path over the cross-instance cache, to avoid a DB round-trip
// on every call. The shared cache is the source of truth across replicas.
let cachedToken: { token: string; expiresAt: number } | null = null;

/** Test-only: clear the in-process token cache so each test starts cold. */
export function __resetFatSecretTokenCacheForTests(): void {
  cachedToken = null;
}

/** Both credentials present ⇒ FatSecret enabled; otherwise it's simply off. */
function credentials(): { id: string; secret: string } | null {
  const id = env.FATSECRET_CLIENT_ID;
  const secret = env.FATSECRET_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

/** Configured OAuth scopes (space-delimited). */
function scopes(): string[] {
  return env.FATSECRET_SCOPE.split(/\s+/).filter(Boolean);
}
/** Premier-tier methods (foods.search.v3, food.get.v4) need the `premier` scope.
 *  The free Basic tier only has `basic` and must use the v1 methods. */
function hasPremierScope(): boolean {
  return scopes().includes("premier");
}
/** Barcode lookup needs the dedicated `barcode` scope (Premier tiers only). */
function hasBarcodeScope(): boolean {
  return scopes().includes("barcode");
}

// ---------------------------------------------------------------------------
// OAuth2 token management
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

/** Thrown on a 401 so the call wrapper can refresh the token exactly once. */
class FatSecretUnauthorizedError extends Error {
  constructor() {
    super("FatSecret request unauthorized (token expired or revoked)");
    this.name = "FatSecretUnauthorizedError";
  }
}

/** Mint a fresh access token. Returns null (never throws) on any failure so the
 *  whole client degrades — a 400/401/403 here is typically bad credentials or a
 *  source IP that isn't whitelisted in the FatSecret dashboard. */
async function fetchToken(creds: { id: string; secret: string }): Promise<{ token: string; ttlMs: number } | null> {
  const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials", scope: env.FATSECRET_SCOPE });
  try {
    const raw = await retryWithJitter(
      async () => {
        const res = await fetch(FATSECRET_TOKEN_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: body.toString(),
          signal: AbortSignal.timeout(FATSECRET_TIMEOUT_MS),
        });
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableHttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
        }
        if (!res.ok) throw new Error(`FatSecret token request failed with HTTP ${res.status}`);
        return (await res.json()) as TokenResponse;
      },
      { retries: 2, label: "fatsecret-token" },
    );
    if (!raw.access_token || typeof raw.expires_in !== "number") return null;
    return { token: raw.access_token, ttlMs: raw.expires_in * 1000 };
  } catch (err) {
    logger.warn({ err }, "[nutrition] FatSecret token request failed; degrading to USDA/OFF");
    return null;
  }
}

async function getAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const creds = credentials();
  if (!creds) return null;

  const nowMs = Date.now();
  if (opts.forceRefresh) {
    cachedToken = null;
    await deleteRuntimeCache(TOKEN_CACHE_KEY).catch(() => {});
  } else {
    if (cachedToken && cachedToken.expiresAt > nowMs) return cachedToken.token;
    // Another replica may have minted one we can reuse.
    const shared = await getRuntimeCache<{ token: string; expiresAt: number }>(TOKEN_CACHE_KEY);
    if (shared && shared.expiresAt > nowMs) {
      cachedToken = shared;
      return shared.token;
    }
  }

  const fetched = await fetchToken(creds);
  if (!fetched) return null;
  const ttlMs = Math.max(1_000, fetched.ttlMs - TOKEN_EXPIRY_MARGIN_MS);
  cachedToken = { token: fetched.token, expiresAt: nowMs + ttlMs };
  await setRuntimeCache(TOKEN_CACHE_KEY, cachedToken, ttlMs).catch((err) => {
    logger.warn({ err }, "[nutrition] FatSecret token cache write failed (non-fatal)");
  });
  return fetched.token;
}

// ---------------------------------------------------------------------------
// Authenticated API calls
// ---------------------------------------------------------------------------

interface FatSecretErrorEnvelope {
  // FatSecret returns HTTP 200 with this envelope for API-level errors — the
  // analogue of Open Food Facts' `status: 0`. Callers must treat it as an empty
  // result, never an exception.
  error?: { code?: number; message?: string };
}

/** "Nothing found"-class error codes (vs. an auth/scope failure). FatSecret uses
 *  these for an invalid/unknown id or barcode, which we surface as no result. */
function isNotFoundError(code: number | undefined): boolean {
  return code === 106 || code === 211;
}

async function callFatSecretOnce<T>(params: Record<string, string>, token: string, signal?: AbortSignal): Promise<T> {
  const body = new URLSearchParams({ ...params, format: "json" });
  return retryWithJitter(
    async () => {
      const timeout = AbortSignal.timeout(FATSECRET_TIMEOUT_MS);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const res = await fetch(FATSECRET_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: sig,
      });
      if (res.status === 401) throw new FatSecretUnauthorizedError();
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableHttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
      }
      if (!res.ok) throw new Error(`FatSecret request failed with HTTP ${res.status}`);
      return (await res.json()) as T;
    },
    { retries: 2, label: "fatsecret" },
  );
}

/** Make an authenticated call, refreshing the token once on a 401. Returns null
 *  (never throws) on any failure so callers degrade. The `{ error }` envelope is
 *  passed through in the body for the caller to interpret. */
async function callFatSecret<T>(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<(T & FatSecretErrorEnvelope) | null> {
  let token = await getAccessToken();
  if (!token) return null;
  try {
    return await callFatSecretOnce<T & FatSecretErrorEnvelope>(params, token, signal);
  } catch (err) {
    if (err instanceof FatSecretUnauthorizedError) {
      token = await getAccessToken({ forceRefresh: true });
      if (!token) return null;
      try {
        return await callFatSecretOnce<T & FatSecretErrorEnvelope>(params, token, signal);
      } catch (retryErr) {
        logger.warn({ err: retryErr }, "[nutrition] FatSecret request failed after token refresh");
        return null;
      }
    }
    logger.warn({ err, method: params.method }, "[nutrition] FatSecret request failed; degrading");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response shapes + per-serving → per-100g mapping
// ---------------------------------------------------------------------------

interface FatSecretServing {
  metric_serving_amount?: string | number;
  metric_serving_unit?: string;
  calories?: string | number;
  carbohydrate?: string | number;
  protein?: string | number;
  fat?: string | number;
  fiber?: string | number;
  // Micros are read dynamically by MICRO_DEFS[].fatsecretKey (mg minerals only).
  [key: string]: unknown;
}

interface FatSecretFood {
  food_id?: string | number;
  food_name?: string;
  brand_name?: string;
  food_type?: string;
  // v1 `foods.search` returns macros only as a summary string, e.g.
  // "Per 1 bar (68g) - Calories: 250kcal | Fat: 5.00g | Carbs: 44.00g | Protein: 9.00g".
  food_description?: string;
  servings?: { serving?: FatSecretServing | FatSecretServing[] };
}

interface FatSecretSearchResponse {
  // v3 envelope: foods_search.results.food. The v1 `foods.food` is accepted as a
  // defensive fallback in case a tier returns the older shape.
  foods_search?: { results?: { food?: FatSecretFood | FatSecretFood[] } };
  foods?: { food?: FatSecretFood | FatSecretFood[] };
}

interface FatSecretBarcodeResponse {
  food_id?: { value?: string | number };
}

interface FatSecretFoodGetResponse {
  food?: FatSecretFood;
}

/** FatSecret returns numbers as strings ("120.000"); coerce to a finite number. */
function num(value: string | number | null | undefined): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Convert a FatSecret metric serving to grams. Volume (ml) is skipped — no
 *  density to convert with — matching the USDA/OFF clients' weight-only behavior. */
function metricServingToGrams(amount: number | null, unit: string | undefined): number | null {
  if (amount === null || amount <= 0 || !unit) return null;
  switch (unit.toLowerCase()) {
    case "g":
      return amount;
    case "oz":
      return amount * OZ_TO_GRAMS;
    default:
      return null;
  }
}

function toServingArray(servings: FatSecretFood["servings"]): FatSecretServing[] {
  const s = servings?.serving;
  if (!s) return [];
  return Array.isArray(s) ? s : [s];
}

/** Choose a gram-convertible serving as the per-100g basis, preferring one
 *  already expressed in grams; null when every serving is volume-only. */
function pickGramServing(servings: FatSecretServing[]): { serving: FatSecretServing; grams: number } | null {
  const candidates = servings
    .map((serving) => ({
      serving,
      grams: metricServingToGrams(num(serving.metric_serving_amount), serving.metric_serving_unit),
    }))
    .filter((c): c is { serving: FatSecretServing; grams: number } => c.grams !== null && c.grams > 0);
  if (candidates.length === 0) return null;
  const inGrams = candidates.find((c) => (c.serving.metric_serving_unit ?? "").toLowerCase() === "g");
  return inGrams ?? candidates[0];
}

/** Per-100g micros from the chosen serving. Only the MICRO_DEFS entries with a
 *  `fatsecretKey` (the unambiguous mg minerals) are read; their value is already
 *  in the micro's unit (mg), so we only rescale per-serving → per-100g. */
function extractMicros(serving: FatSecretServing, grams: number): Record<string, number> | null {
  const micros: Record<string, number> = {};
  for (const def of MICRO_DEFS) {
    if (!def.fatsecretKey) continue;
    const perServing = num(serving[def.fatsecretKey] as string | number | undefined);
    if (perServing !== null && perServing >= 0) micros[def.key] = (perServing * 100) / grams;
  }
  return Object.keys(micros).length > 0 ? micros : null;
}

/** Assemble a per-100g MappedFood from a FatSecret food + its computed macros.
 *  Shared by the v3 and v1 mappers so the row shape lives in one place. */
function toMappedFatSecretFood(
  raw: FatSecretFood,
  grams: number,
  macros: {
    calories: number | null;
    protein: number | null;
    carb: number | null;
    fat: number | null;
    fiber: number | null;
    micros: Record<string, number> | null;
  },
): MappedFood {
  return {
    source: "fatsecret",
    sourceId: String(raw.food_id),
    name: (raw.food_name ?? "").trim(),
    brand: raw.brand_name?.trim() || null,
    servingSizeG: grams,
    caloriesPer100g: macros.calories,
    proteinPer100g: macros.protein,
    carbPer100g: macros.carb,
    fatPer100g: macros.fat,
    fiberPer100g: macros.fiber,
    micros: macros.micros,
  };
}

/** Map one FatSecret food (with inline servings) into our per-100g shape, or null
 *  when unusable (no name/id, or only volume servings). */
export function mapFatSecretFood(raw: FatSecretFood): MappedFood | null {
  const foodId = raw.food_id;
  const name = raw.food_name?.trim();
  if ((typeof foodId !== "string" && typeof foodId !== "number") || !name) return null;

  const picked = pickGramServing(toServingArray(raw.servings));
  if (!picked) return null;
  const { serving, grams } = picked;

  const per100 = (value: string | number | undefined): number | null => {
    const n = num(value);
    return n === null ? null : (n * 100) / grams;
  };

  return toMappedFatSecretFood(raw, grams, {
    calories: per100(serving.calories),
    protein: per100(serving.protein),
    carb: per100(serving.carbohydrate),
    fat: per100(serving.fat),
    fiber: per100(serving.fiber),
    micros: extractMicros(serving, grams),
  });
}

function normalizeFoodList(food: FatSecretFood | FatSecretFood[] | undefined): FatSecretFood[] {
  if (!food) return [];
  return Array.isArray(food) ? food : [food];
}

// --- Basic (v1) tier: parse macros from the food_description summary string ----

/** Read a "Label: <number>" field from a v1 description. */
function readDescriptionField(desc: string, pattern: RegExp): number | null {
  const m = pattern.exec(desc);
  return m ? num(m[1]) : null;
}

/** The gram basis a v1 `food_description` is stated per ("Per 100g", "Per 1 bar
 *  (68g)", "Per 1 oz", …). null for a volume basis (ml / fl oz) we can't convert. */
function parseDescriptionGrams(desc: string): number | null {
  const paren = /\(([\d.]+)\s*(g|ml|oz|fl\s*oz)\)/i.exec(desc);
  if (paren) {
    const amount = num(paren[1]);
    const unit = paren[2].toLowerCase().replace(/\s+/g, "");
    if (amount === null || amount <= 0) return null;
    if (unit === "g") return amount;
    if (unit === "oz") return amount * OZ_TO_GRAMS;
    return null; // ml / fl oz — volume, skip
  }
  const direct = /^Per\s+([\d.]+)\s*(g|oz)\b/i.exec(desc);
  if (direct) {
    const amount = num(direct[1]);
    if (amount === null || amount <= 0) return null;
    return direct[2].toLowerCase() === "oz" ? amount * OZ_TO_GRAMS : amount;
  }
  return null;
}

/** Map a Basic-tier (v1) search result — whose macros live in `food_description`
 *  rather than structured servings — into per-100g. fiber/micros aren't in the v1
 *  summary (left null). null when the basis is volume-only or unparseable. */
export function mapFatSecretV1Food(raw: FatSecretFood): MappedFood | null {
  const foodId = raw.food_id;
  const name = raw.food_name?.trim();
  const desc = raw.food_description;
  if ((typeof foodId !== "string" && typeof foodId !== "number") || !name || !desc) return null;

  const grams = parseDescriptionGrams(desc);
  if (grams === null || grams <= 0) return null;
  const per100 = (value: number | null): number | null => (value === null ? null : (value * 100) / grams);

  return toMappedFatSecretFood(raw, grams, {
    calories: per100(readDescriptionField(desc, /Calories:\s*([\d.]+)/i)),
    protein: per100(readDescriptionField(desc, /Protein:\s*([\d.]+)/i)),
    carb: per100(readDescriptionField(desc, /Carb(?:s|ohydrate)?:\s*([\d.]+)/i)),
    fat: per100(readDescriptionField(desc, /Fat:\s*([\d.]+)/i)),
    fiber: null,
    micros: null,
  });
}

// ---------------------------------------------------------------------------
// Exported operations
// ---------------------------------------------------------------------------

export interface FatSecretSearchResult {
  foods: MappedFood[];
  /** false when FatSecret is unconfigured or its API couldn't be reached (no
   *  credentials, a non-whitelisted IP, an auth/scope error) — i.e. these are NOT
   *  live FatSecret results, so the orchestrator treats search as degraded unless
   *  another provider was live. A genuine zero-match counts as reached. */
  reached: boolean;
}

/** Search FatSecret for branded + generic foods. v3 returns servings inline, so
 *  one call yields mappable per-100g foods (no N+1 detail fetch). Never throws —
 *  on any unavailability it reports `reached: false` and the orchestrator falls
 *  back to USDA + cache. */
export async function searchFatSecretFoods(
  query: string,
  opts: { signal?: AbortSignal } = {},
): Promise<FatSecretSearchResult> {
  if (!credentials()) return { foods: [], reached: false };
  // Premier exposes foods.search.v3 (servings inline); the free Basic tier only
  // has v1 foods.search, whose macros come back as a description string we parse.
  const premier = hasPremierScope();
  const body = await callFatSecret<FatSecretSearchResponse>(
    {
      method: premier ? "foods.search.v3" : "foods.search",
      search_expression: query,
      max_results: String(FATSECRET_MAX_RESULTS),
      // region/language need the localization scope (Premier); omit on Basic.
      ...(premier && env.FATSECRET_REGION ? { region: env.FATSECRET_REGION } : {}),
      ...(premier && env.FATSECRET_LANGUAGE ? { language: env.FATSECRET_LANGUAGE } : {}),
    },
    opts.signal,
  );
  if (!body) return { foods: [], reached: false };
  if (body.error) {
    // A genuine "no match" still means FatSecret was reached and live.
    if (isNotFoundError(body.error.code)) return { foods: [], reached: true };
    logger.warn({ code: body.error.code, message: body.error.message }, "[nutrition] FatSecret search error");
    return { foods: [], reached: false };
  }
  const mapped = premier
    ? normalizeFoodList(body.foods_search?.results?.food).map(mapFatSecretFood)
    : normalizeFoodList(body.foods?.food).map(mapFatSecretV1Food);
  return { foods: mapped.filter((f): f is MappedFood => f !== null), reached: true };
}

/** Fetch a FatSecret food's full detail by food_id, mapped to per-100g. Shared by
 *  barcode resolution and the cache-staleness refresh. */
export async function getFatSecretFoodById(
  foodId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MappedFood | null> {
  if (!hasPremierScope()) return null; // food.get.v4 is Premier-only
  const body = await callFatSecret<FatSecretFoodGetResponse>(
    { method: "food.get.v4", food_id: foodId },
    opts.signal,
  );
  if (!body || body.error || !body.food) return null;
  return mapFatSecretFood(body.food);
}

/** Left-pad a UPC/EAN-8/EAN-13 to the GTIN-13 FatSecret's barcode lookup expects. */
function toGtin13(code: string): string {
  return code.length >= 13 ? code : code.padStart(13, "0");
}

/** Resolve a barcode to a food via FatSecret (find-id → full food detail).
 *  Returns null when FatSecret is unconfigured/unavailable or the barcode is
 *  unknown, so the caller falls back to Open Food Facts. */
export async function resolveFatSecretBarcode(
  code: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MappedFood | null> {
  // Barcode needs the `barcode` scope (Premier); on Basic, skip straight to Open
  // Food Facts rather than spend a call that will fail.
  if (!hasBarcodeScope()) return null;
  const idBody = await callFatSecret<FatSecretBarcodeResponse>(
    { method: "food.find_id_for_barcode", barcode: toGtin13(code) },
    opts.signal,
  );
  if (!idBody) return null;
  if (idBody.error) {
    if (!isNotFoundError(idBody.error.code)) {
      logger.warn({ code: idBody.error.code }, "[nutrition] FatSecret barcode lookup error");
    }
    return null;
  }
  const foodId = idBody.food_id?.value;
  // FatSecret returns food_id "0" for an unknown barcode.
  if (foodId === undefined || foodId === null || String(foodId) === "0" || String(foodId) === "") return null;

  return getFatSecretFoodById(String(foodId), opts);
}
