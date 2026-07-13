import {
  CALORIES_PER_100G_MAX,
  type ExtractedNutritionLabel,
  type LabelFoodSuggestion,
  type LabelMacroSet,
  MACRO_PER_100G_MAX,
  type ParseLabelResponse,
  SERVING_SIZE_G_MAX,
} from "@shared/schema";
import { z } from "zod";

import { AppError, ErrorCode } from "../../errors";
import { GEMINI_VISION_MODEL, getAiClient, retryWithBackoff, trackUsageFromResponse } from "../../gemini/client";
import { logger } from "../../logger";
import { PARSE_LABEL_PROMPT } from "../../prompts";
import { validateAiOutput } from "../../utils/sanitize";

/**
 * Nutrition-label transcription (label-scan flow). Unlike the meal photo parser
 * (which *estimates* foods and portions), this asks the vision model to
 * transcribe the printed nutrition facts panel verbatim, then normalizes the
 * result to the per-100g shape `foods` stores — all unit conversion and
 * per-serving→per-100g math happens here in code, never in the model. Nothing
 * is persisted; the client prefills the custom-food form for review.
 */

const KJ_PER_KCAL = 4.184;

// Lenient field-level parsing: a garbled field becomes null/default rather than
// failing the whole payload (same spirit as the meal parser's per-item salvage).
const rawNumber = z.number().finite().nonnegative().nullable().catch(null);

const rawMacroSetSchema = z
  .object({
    calories: rawNumber,
    protein: rawNumber,
    carb: rawNumber,
    fat: rawNumber,
    fiber: rawNumber,
  })
  .nullable()
  .catch(null);

const rawLabelSchema = z.object({
  productName: z.string().trim().min(1).max(200).nullable().catch(null),
  brand: z.string().trim().min(1).max(200).nullable().catch(null),
  servingSizeText: z.string().trim().min(1).max(120).nullable().catch(null),
  servingSizeG: z.number().positive().max(SERVING_SIZE_G_MAX).nullable().catch(null),
  energyUnit: z.enum(["kcal", "kJ"]).catch("kcal"),
  per100g: rawMacroSetSchema,
  perServing: rawMacroSetSchema,
  confidence: z.number().min(0).max(100).catch(50),
  warnings: z.array(z.string().trim().min(1).max(300)).max(10).catch([]),
});

type RawLabel = z.infer<typeof rawLabelSchema>;
type RawMacroSet = z.infer<typeof rawMacroSetSchema>;

const NO_LABEL: ParseLabelResponse = { label: null, suggestion: null, warnings: [] };

const round1 = (n: number) => Math.round(n * 10) / 10;

function hasAnyValue(set: RawMacroSet): set is NonNullable<RawMacroSet> {
  return set != null && Object.values(set).some((v) => v != null);
}

/** kJ → kcal for one printed column (labels outside the US often print kJ only). */
function toKcal(set: NonNullable<RawMacroSet>): LabelMacroSet {
  return { ...set, calories: set.calories == null ? null : round1(set.calories / KJ_PER_KCAL) };
}

/**
 * Normalize a transcribed label into the review payload: pick the per-100g
 * column when printed, otherwise derive it from per-serving + serving grams.
 * A per-serving-only label with no gram weight yields a null-macro suggestion
 * (assuming 100 g would silently corrupt the food) — the raw per-serving
 * values stay on `label` for the UI to show read-only.
 */
export function normalizeLabel(raw: RawLabel): ParseLabelResponse {
  const warnings = [...raw.warnings];

  const toColumn = (set: RawMacroSet): LabelMacroSet | null => {
    if (!hasAnyValue(set)) return null;
    return raw.energyUnit === "kJ" ? toKcal(set) : set;
  };
  const per100g = toColumn(raw.per100g);
  const perServing = toColumn(raw.perServing);
  if (!per100g && !perServing) return NO_LABEL;
  if (raw.energyUnit === "kJ" && (per100g?.calories != null || perServing?.calories != null)) {
    warnings.push("Energy was printed in kJ and converted to kcal.");
  }

  let basis: ExtractedNutritionLabel["basis"];
  if (per100g && perServing) basis = "both";
  else if (per100g) basis = "per100g";
  else basis = "perServing";

  let suggested: LabelMacroSet | null = per100g;
  if (!suggested && perServing) {
    if (raw.servingSizeG != null) {
      const scale = 100 / raw.servingSizeG;
      suggested = {
        calories: perServing.calories == null ? null : round1(perServing.calories * scale),
        protein: perServing.protein == null ? null : round1(perServing.protein * scale),
        carb: perServing.carb == null ? null : round1(perServing.carb * scale),
        fat: perServing.fat == null ? null : round1(perServing.fat * scale),
        fiber: perServing.fiber == null ? null : round1(perServing.fiber * scale),
      };
      warnings.push("Per-100g values were derived from the printed per-serving column.");
    } else {
      warnings.push(
        "The label only shows per-serving values without a gram weight, so per-100g macros must be entered manually.",
      );
    }
  }

  // Clamp to the shared custom-food caps so the prefilled form can always save.
  let clampedAny = false;
  const clamp = (v: number | null, max: number) => {
    if (v == null) return null;
    if (v > max) {
      clampedAny = true;
      return null;
    }
    return v;
  };
  const suggestion: LabelFoodSuggestion = {
    name: raw.productName,
    brand: raw.brand,
    caloriesPer100g: clamp(suggested?.calories ?? null, CALORIES_PER_100G_MAX),
    proteinPer100g: clamp(suggested?.protein ?? null, MACRO_PER_100G_MAX),
    carbPer100g: clamp(suggested?.carb ?? null, MACRO_PER_100G_MAX),
    fatPer100g: clamp(suggested?.fat ?? null, MACRO_PER_100G_MAX),
    fiberPer100g: clamp(suggested?.fiber ?? null, MACRO_PER_100G_MAX),
    servingSizeG: raw.servingSizeG,
  };
  if (clampedAny) {
    warnings.push("Some values looked implausible for 100 g and were left blank.");
  }

  return {
    label: {
      productName: raw.productName,
      brand: raw.brand,
      servingSizeText: raw.servingSizeText,
      servingSizeG: raw.servingSizeG,
      per100g,
      perServing,
      basis,
      confidence: raw.confidence,
    },
    suggestion,
    warnings,
  };
}

/**
 * Gemini-direct vision call for a label photo. Same shape as the meal photo
 * parser (mealParser.ts): the provider abstraction has no vision method, so
 * this talks to the Gemini client directly with the image as `inlineData`.
 */
async function callGeminiParseLabelImage(
  imageBase64: string,
  mimeType: string,
  userId: string,
): Promise<string> {
  const response = await retryWithBackoff(
    (signal) =>
      getAiClient().models.generateContent({
        model: GEMINI_VISION_MODEL,
        config: {
          systemInstruction: PARSE_LABEL_PROMPT,
          responseMimeType: "application/json",
          abortSignal: signal,
        },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: "Transcribe the nutrition facts panel in the attached photo exactly as printed." },
            ],
          },
        ],
      }),
    "nutrition-label-parse-image",
  );

  // Track usage before the empty check — the call consumed tokens regardless.
  trackUsageFromResponse(userId, GEMINI_VISION_MODEL, "parse", response);

  if (!response.text || response.text.length === 0) {
    throw new AppError(ErrorCode.AI_ERROR, "AI returned empty response for label parsing", 502);
  }
  return validateAiOutput(response.text);
}

function parseJson(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch {
    logger.error("[ai] label-parse JSON.parse failed");
    throw new AppError(ErrorCode.AI_ERROR, "AI returned invalid JSON for label parsing", 502);
  }
}

/**
 * Parse a nutrition-label photo into a reviewed-before-save payload. Returns
 * `label: null` (HTTP 200) when the image holds no readable label — that's an
 * expected outcome, not an error.
 */
export async function parseNutritionLabel(
  imageBase64: string,
  mimeType: string,
  userId: string,
): Promise<ParseLabelResponse> {
  try {
    const payload = parseJson(await callGeminiParseLabelImage(imageBase64, mimeType, userId));
    // The prompt's "no readable label" sentinel is { "label": null }.
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return NO_LABEL;
    if ("label" in payload && (payload as Record<string, unknown>).label == null) return NO_LABEL;
    const raw = rawLabelSchema.safeParse(payload);
    if (!raw.success) {
      // Plain static message — never interpolate the zod issues or the payload.
      logger.warn("[ai] label-parse payload failed validation");
      return NO_LABEL;
    }
    return normalizeLabel(raw.data);
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("[ai] label-parse-image error");
    throw new AppError(ErrorCode.AI_ERROR, "Failed to parse nutrition label from photo", 502);
  }
}
