/**
 * shared/schema/micros.ts, ported to mobile/core/.../core/nutrition/Micros.kt.
 *
 * The table is data: the app's Log Food preview reads each micronutrient's
 * label, unit and RDI from it, so its %RDI agrees with the server's
 * GET /api/v1/nutrition/micros (docs/mobile-shared-logic.md).
 */
import { MICRO_DISPLAY_DEFS } from "@shared/schema/micros";

import { suite } from "../types";

export const microsSuites = [
  suite({
    name: "micros.constants",
    description: "MICRO_DISPLAY_DEFS: the curated micronutrients in display order, with label, unit and FDA Daily Value.",
    run: () => ({ MICRO_DISPLAY_DEFS }),
    cases: [null],
  }),
];
