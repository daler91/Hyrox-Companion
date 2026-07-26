import { type CoverageStation, stationLabel } from "@shared/stationCoverage";
import { Radar } from "lucide-react";

import {
  type AnalysisTone,
  getFreshnessLabel,
  STALE_AFTER_DAYS,
} from "@/components/analytics/coverageAnalysis";
import { cn } from "@/lib/utils";

/** A station has gone quiet well before it counts as stale. */
const WATCH_AFTER_DAYS = 7;

const TONE_CLASSNAMES: Record<AnalysisTone, string> = {
  good: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  watch:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  gap: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

export interface StationRadarChip {
  readonly station: string;
  readonly label: string;
  readonly freshness: string;
  readonly tone: AnalysisTone;
}

export interface StationRadarSummary {
  readonly chips: readonly StationRadarChip[];
  readonly headline: string;
}

function toneFor(daysSince: number | null): AnalysisTone {
  if (daysSince === null || daysSince > STALE_AFTER_DAYS) return "gap";
  if (daysSince > WATCH_AFTER_DAYS) return "watch";
  return "good";
}

/**
 * Turn the training-overview station coverage into a chip row plus a sentence
 * naming the coldest station.
 *
 * Returns null when there is nothing to show, so a fresh athlete doesn't get a
 * wall of red telling them they've neglected nine things they've never done.
 */
export function buildStationRadar(
  coverage: readonly { station: string; lastTrained: string | null; daysSince: number | null }[],
): StationRadarSummary | null {
  if (coverage.length === 0) return null;
  if (coverage.every((entry) => entry.lastTrained === null)) return null;

  const chips = coverage.map((entry) => ({
    station: entry.station,
    label: stationLabel(entry.station as CoverageStation),
    freshness: getFreshnessLabel(entry.daysSince),
    tone: toneFor(entry.daysSince),
  }));

  // Never-trained outranks merely-stale: a station you have never touched is a
  // bigger hole than one you did three weeks ago.
  const untouched = coverage.filter((entry) => entry.lastTrained === null);
  const coldest =
    untouched.length > 0
      ? untouched[0]
      : coverage.reduce((worst, entry) =>
          (entry.daysSince ?? 0) > (worst.daysSince ?? 0) ? entry : worst,
        );

  const coldestLabel = stationLabel(coldest.station as CoverageStation);
  let headline: string;
  if (coldest.lastTrained === null) {
    headline = `${coldestLabel} is untouched — no session has covered it yet.`;
  } else if (toneFor(coldest.daysSince) === "good") {
    headline = `Every station covered in the last ${WATCH_AFTER_DAYS} days.`;
  } else {
    headline = `${coldestLabel} is coldest — ${getFreshnessLabel(coldest.daysSince).toLowerCase()}.`;
  }

  return { chips, headline };
}

/**
 * Days-since-trained across the eight race stations plus running, as a
 * colour-graded chip row on the Timeline.
 *
 * The coverage has shipped on the training-overview payload — which this card's
 * parent already fetches — since it was built, and rendered nowhere. It sits
 * here rather than on the Analytics breakdown tab on purpose: it works as a
 * nudge next to the week you are about to train, and the breakdown tab
 * deliberately retired station coverage in favour of movement-pattern coverage
 * (asserted absent by CategoryBreakdownTab.test.tsx).
 *
 * Each chip carries its own freshness in words, so the tone colour is
 * reinforcement rather than the only signal.
 */
export function StationRadar({ radar }: { readonly radar: StationRadarSummary }) {
  return (
    <div className="space-y-2" data-testid="station-radar">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Radar className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Station radar</span>
      </div>
      <p className="text-sm text-foreground" data-testid="station-radar-headline">
        {radar.headline}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {radar.chips.map((chip) => (
          <li key={chip.station}>
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs",
                TONE_CLASSNAMES[chip.tone],
              )}
              data-testid={`station-radar-chip-${chip.station}`}
            >
              {/* The space is load-bearing for assistive tech: flex `gap`
                  separates these visually but leaves the text content running
                  together as "SkiErg2d ago". Whitespace-only content between
                  flex items isn't rendered, so it costs nothing visually. */}
              <span className="font-medium">{chip.label}</span>{" "}
              <span className="tabular-nums opacity-80">{chip.freshness}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
