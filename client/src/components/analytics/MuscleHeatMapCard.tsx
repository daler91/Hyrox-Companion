import type { HeatMapMuscle, TrainingOverview } from "@shared/schema";
import { useMemo } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  type AnalysisMetric,
  buildBalanceAnalysis,
  CoverageAnalysisPanel,
  findPriorityGap,
  findTopCoverage,
  formatCount,
  formatPercent,
  getFreshnessLabel,
  hasCoverageWork,
  STALE_AFTER_DAYS,
  sumCoverageSets,
} from "./coverageAnalysis";

type MuscleCoverage = TrainingOverview["muscleGroupCoverage"][number];
type BodySide = "front" | "back";
type HeatTone = {
  readonly label: string;
  readonly zoneClass: string;
  readonly tileClass: string;
  readonly swatchClass: string;
};

type MuscleShape =
  | {
    readonly kind: "ellipse";
    readonly muscle: HeatMapMuscle;
    readonly side: BodySide;
    readonly cx: number;
    readonly cy: number;
    readonly rx: number;
    readonly ry: number;
    readonly rotate?: number;
  }
  | {
    readonly kind: "rect";
    readonly muscle: HeatMapMuscle;
    readonly side: BodySide;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rx?: number;
  }
  | {
    readonly kind: "path";
    readonly muscle: HeatMapMuscle;
    readonly side: BodySide;
    readonly d: string;
  };

const REGION_LABELS = {
  upper: "Upper body",
  core: "Core",
  lower: "Lower body",
} as const;

const UPPER_PUSH_MUSCLES = ["chest", "shoulders", "triceps"] as const satisfies readonly HeatMapMuscle[];
const UPPER_PULL_MUSCLES = ["lats", "upper_back", "rear_delts", "traps", "biceps"] as const satisfies readonly HeatMapMuscle[];
const POSTERIOR_CHAIN_MUSCLES = ["hamstrings", "glutes", "lower_back"] as const satisfies readonly HeatMapMuscle[];
const CORE_FRESHNESS_MUSCLES: ReadonlySet<HeatMapMuscle> = new Set<HeatMapMuscle>(["core", "obliques", "lower_back"]);

const HEAT_TONES: readonly HeatTone[] = [
  {
    label: "No set volume",
    zoneClass: "fill-muted/40 stroke-border",
    tileClass: "border-border bg-muted/20 text-muted-foreground",
    swatchClass: "bg-muted/60",
  },
  {
    label: "Light set volume",
    zoneClass: "fill-sky-300 stroke-sky-700/30 dark:fill-sky-500/40 dark:stroke-sky-300/40",
    tileClass: "border-sky-500/30 bg-sky-500/10",
    swatchClass: "bg-sky-400",
  },
  {
    label: "Moderate set volume",
    zoneClass: "fill-amber-300 stroke-amber-700/30 dark:fill-amber-500/50 dark:stroke-amber-300/40",
    tileClass: "border-amber-500/40 bg-amber-500/10",
    swatchClass: "bg-amber-400",
  },
  {
    label: "High set volume",
    zoneClass: "fill-orange-400 stroke-orange-800/40 dark:fill-orange-500/65 dark:stroke-orange-300/40",
    tileClass: "border-orange-500/40 bg-orange-500/10",
    swatchClass: "bg-orange-500",
  },
  {
    label: "Peak set volume",
    zoneClass: "fill-red-500 stroke-red-900/40 dark:fill-red-500/80 dark:stroke-red-300/40",
    tileClass: "border-red-500/45 bg-red-500/10",
    swatchClass: "bg-red-500",
  },
];

const MUSCLE_SHAPES: readonly MuscleShape[] = [
  { kind: "ellipse", side: "front", muscle: "shoulders", cx: 38, cy: 66, rx: 15, ry: 12, rotate: -18 },
  { kind: "ellipse", side: "front", muscle: "shoulders", cx: 82, cy: 66, rx: 15, ry: 12, rotate: 18 },
  { kind: "path", side: "front", muscle: "chest", d: "M42 80 C46 70 56 68 60 78 L60 104 C51 103 43 98 38 89 Z" },
  { kind: "path", side: "front", muscle: "chest", d: "M60 78 C64 68 74 70 78 80 L82 89 C77 98 69 103 60 104 Z" },
  { kind: "ellipse", side: "front", muscle: "biceps", cx: 28, cy: 107, rx: 9, ry: 22, rotate: 8 },
  { kind: "ellipse", side: "front", muscle: "biceps", cx: 92, cy: 107, rx: 9, ry: 22, rotate: -8 },
  { kind: "ellipse", side: "front", muscle: "forearms", cx: 22, cy: 158, rx: 8, ry: 25, rotate: 9 },
  { kind: "ellipse", side: "front", muscle: "forearms", cx: 98, cy: 158, rx: 8, ry: 25, rotate: -9 },
  { kind: "rect", side: "front", muscle: "core", x: 48, y: 107, width: 24, height: 44, rx: 8 },
  { kind: "path", side: "front", muscle: "obliques", d: "M39 105 L49 109 L48 151 L38 145 C37 130 37 116 39 105 Z" },
  { kind: "path", side: "front", muscle: "obliques", d: "M72 109 L81 105 C83 116 83 130 82 145 L72 151 Z" },
  { kind: "path", side: "front", muscle: "hip_flexors", d: "M43 156 L60 151 L77 156 L70 175 L50 175 Z" },
  { kind: "ellipse", side: "front", muscle: "quads", cx: 49, cy: 216, rx: 12, ry: 40 },
  { kind: "ellipse", side: "front", muscle: "quads", cx: 71, cy: 216, rx: 12, ry: 40 },
  { kind: "path", side: "front", muscle: "adductors", d: "M55 177 L60 178 L60 247 L51 247 C51 221 52 198 55 177 Z" },
  { kind: "path", side: "front", muscle: "adductors", d: "M60 178 L65 177 C68 198 69 221 69 247 L60 247 Z" },
  { kind: "ellipse", side: "front", muscle: "tibialis", cx: 48, cy: 280, rx: 8, ry: 31 },
  { kind: "ellipse", side: "front", muscle: "tibialis", cx: 72, cy: 280, rx: 8, ry: 31 },
  { kind: "ellipse", side: "front", muscle: "calves", cx: 39, cy: 277, rx: 6, ry: 27, rotate: -6 },
  { kind: "ellipse", side: "front", muscle: "calves", cx: 81, cy: 277, rx: 6, ry: 27, rotate: 6 },
  { kind: "path", side: "back", muscle: "traps", d: "M47 56 L60 45 L73 56 L68 78 L52 78 Z" },
  { kind: "ellipse", side: "back", muscle: "rear_delts", cx: 39, cy: 76, rx: 13, ry: 11, rotate: -18 },
  { kind: "ellipse", side: "back", muscle: "rear_delts", cx: 81, cy: 76, rx: 13, ry: 11, rotate: 18 },
  { kind: "path", side: "back", muscle: "upper_back", d: "M43 79 C50 74 70 74 77 79 L73 111 C65 116 55 116 47 111 Z" },
  { kind: "path", side: "back", muscle: "lats", d: "M36 88 C43 96 48 110 48 132 L39 143 C34 124 32 105 36 88 Z" },
  { kind: "path", side: "back", muscle: "lats", d: "M84 88 C88 105 86 124 81 143 L72 132 C72 110 77 96 84 88 Z" },
  { kind: "ellipse", side: "back", muscle: "triceps", cx: 28, cy: 113, rx: 9, ry: 24, rotate: 8 },
  { kind: "ellipse", side: "back", muscle: "triceps", cx: 92, cy: 113, rx: 9, ry: 24, rotate: -8 },
  { kind: "ellipse", side: "back", muscle: "forearms", cx: 22, cy: 162, rx: 8, ry: 25, rotate: 9 },
  { kind: "ellipse", side: "back", muscle: "forearms", cx: 98, cy: 162, rx: 8, ry: 25, rotate: -9 },
  { kind: "rect", side: "back", muscle: "lower_back", x: 48, y: 117, width: 24, height: 38, rx: 8 },
  { kind: "ellipse", side: "back", muscle: "glutes", cx: 49, cy: 174, rx: 14, ry: 18 },
  { kind: "ellipse", side: "back", muscle: "glutes", cx: 71, cy: 174, rx: 14, ry: 18 },
  { kind: "ellipse", side: "back", muscle: "hip_abductors", cx: 39, cy: 178, rx: 8, ry: 17, rotate: 16 },
  { kind: "ellipse", side: "back", muscle: "hip_abductors", cx: 81, cy: 178, rx: 8, ry: 17, rotate: -16 },
  { kind: "ellipse", side: "back", muscle: "hamstrings", cx: 49, cy: 224, rx: 11, ry: 41 },
  { kind: "ellipse", side: "back", muscle: "hamstrings", cx: 71, cy: 224, rx: 11, ry: 41 },
  { kind: "ellipse", side: "back", muscle: "calves", cx: 48, cy: 283, rx: 10, ry: 31 },
  { kind: "ellipse", side: "back", muscle: "calves", cx: 72, cy: 283, rx: 10, ry: 31 },
];

function getHeatLevel(totalSets: number, maxTotalSets: number): number {
  if (totalSets <= 0 || maxTotalSets <= 0) return 0;
  const ratio = totalSets / maxTotalSets;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function getHeatTone(totalSets: number, maxTotalSets: number): HeatTone {
  return HEAT_TONES[getHeatLevel(totalSets, maxTotalSets)] ?? HEAT_TONES[0];
}

function buildCoreFreshnessMetric(muscles: readonly MuscleCoverage[]): AnalysisMetric {
  const coreMuscles = muscles.filter((muscle) => (
    CORE_FRESHNESS_MUSCLES.has(muscle.muscle)
  ));
  const trainedCore = coreMuscles.filter(hasCoverageWork);
  const freshest = [...trainedCore]
    .sort((a, b) => (a.daysSince ?? Number.POSITIVE_INFINITY) - (b.daysSince ?? Number.POSITIVE_INFINITY))[0] ?? null;
  const staleOrMissing = coreMuscles.filter((muscle) => !hasCoverageWork(muscle) || muscle.daysSince === null || muscle.daysSince > STALE_AFTER_DAYS);

  if (!freshest) {
    return {
      label: "Core freshness",
      value: "No core work",
      detail: "Core, obliques, and lower back have no logged sets in this range.",
      tone: "gap",
    };
  }

  return {
    label: "Core freshness",
    value: getFreshnessLabel(freshest.daysSince),
    detail: `${freshest.label} is freshest; ${formatCount(staleOrMissing.length, "core area", "core areas")} need attention.`,
    tone: staleOrMissing.length > 0 ? "watch" : "good",
  };
}

function buildMuscleHeatMapAnalysis(muscles: readonly MuscleCoverage[]) {
  const totalSets = muscles.reduce((sum, muscle) => sum + muscle.totalSets, 0);
  const topMuscle = findTopCoverage(muscles);
  const priorityGap = findPriorityGap(muscles, "it has no logged sets in this range");
  const regionTotals = {
    upper: muscles.filter((muscle) => muscle.bodyRegion === "upper").reduce((sum, muscle) => sum + muscle.totalSets, 0),
    core: muscles.filter((muscle) => muscle.bodyRegion === "core").reduce((sum, muscle) => sum + muscle.totalSets, 0),
    lower: muscles.filter((muscle) => muscle.bodyRegion === "lower").reduce((sum, muscle) => sum + muscle.totalSets, 0),
  };
  const regionMix = `Upper ${formatPercent(regionTotals.upper, totalSets)} / Core ${formatPercent(regionTotals.core, totalSets)} / Lower ${formatPercent(regionTotals.lower, totalSets)}`;
  const dominantRegion = (Object.entries(regionTotals) as Array<[keyof typeof regionTotals, number]>)
    .sort((a, b) => b[1] - a[1])[0];
  const balances = [
    buildBalanceAnalysis(
      "Upper Push / Pull",
      "Upper push",
      sumCoverageSets(muscles, UPPER_PUSH_MUSCLES, (muscle) => muscle.muscle),
      "upper pull",
      sumCoverageSets(muscles, UPPER_PULL_MUSCLES, (muscle) => muscle.muscle),
    ),
    buildBalanceAnalysis(
      "Quad / Posterior Chain",
      "Quad work",
      sumCoverageSets(muscles, ["quads"], (muscle) => muscle.muscle),
      "posterior chain",
      sumCoverageSets(muscles, POSTERIOR_CHAIN_MUSCLES, (muscle) => muscle.muscle),
    ),
  ];
  const nextBalance = balances.find((balance) => balance.tone !== "good" && balance.recommendation);
  const leastLoaded = [...muscles]
    .filter(hasCoverageWork)
    .sort((a, b) => a.totalSets - b.totalSets || a.label.localeCompare(b.label))[0] ?? null;

  const metrics: AnalysisMetric[] = [
    {
      label: "Region mix",
      value: totalSets > 0 && dominantRegion ? `${REGION_LABELS[dominantRegion[0]]} ${formatPercent(dominantRegion[1], totalSets)}` : "No set volume",
      detail: `${regionMix} by set volume.`,
      tone: totalSets > 0 ? "good" : "gap",
    },
    {
      label: "Top load",
      value: topMuscle?.label ?? "No loaded muscle",
      detail: topMuscle
        ? `${formatCount(topMuscle.totalSets, "set", "sets")} across ${formatCount(topMuscle.sessionCount, "session", "sessions")}.`
        : "Log mapped sets to reveal the most-loaded muscle group.",
      tone: topMuscle ? "good" : "gap",
    },
    {
      label: "Cold gap",
      value: priorityGap?.item.label ?? "No stale gaps",
      detail: priorityGap?.reason ?? "Every trained muscle group is inside the 14-day freshness window.",
      tone: priorityGap ? "gap" : "good",
    },
    buildCoreFreshnessMetric(muscles),
  ];

  const nextFocus = (() => {
    if (priorityGap) {
      return `Next focus: Add ${priorityGap.item.label}; ${priorityGap.reason}.`;
    }
    if (nextBalance?.recommendation) {
      return `Next focus: ${nextBalance.recommendation}`;
    }
    if (leastLoaded) {
      return `Next focus: Keep ${leastLoaded.label} in rotation; it is the lowest loaded trained muscle group.`;
    }
    return "Next focus: Log mapped strength or functional sets so muscle coverage analysis can start.";
  })();

  return { metrics, balances, nextFocus, totalSets };
}

function makeTransform(shape: MuscleShape): string | undefined {
  if (shape.kind === "ellipse" && shape.rotate) {
    return `rotate(${shape.rotate} ${shape.cx} ${shape.cy})`;
  }
  return undefined;
}

function BodyGuide() {
  return (
    <g className="fill-muted/10 stroke-border" strokeWidth="1.5" aria-hidden="true">
      <circle cx="60" cy="24" r="16" />
      <rect x="51" y="39" width="18" height="17" rx="6" />
      <path d="M39 58 C51 53 69 53 81 58 C87 86 88 128 78 158 L60 169 L42 158 C32 128 33 86 39 58 Z" />
      <path d="M38 68 C20 85 17 132 19 185" fill="none" />
      <path d="M82 68 C100 85 103 132 101 185" fill="none" />
      <path d="M43 168 C38 207 38 261 43 318" fill="none" />
      <path d="M77 168 C82 207 82 261 77 318" fill="none" />
    </g>
  );
}

function MuscleZone({
  shape,
  coverage,
  maxTotalSets,
}: {
  readonly shape: MuscleShape;
  readonly coverage: MuscleCoverage | undefined;
  readonly maxTotalSets: number;
}) {
  const totalSets = coverage?.totalSets ?? 0;
  const tone = getHeatTone(totalSets, maxTotalSets);
  const title = coverage
    ? `${coverage.label}: ${tone.label}, ${formatCount(coverage.totalSets, "set", "sets")}, ${formatCount(coverage.sessionCount, "session", "sessions")}`
    : `${shape.muscle}: no set volume`;
  const className = cn("stroke-[1.5] transition-colors", tone.zoneClass);

  return (
    <g aria-label={title}>
      <title>{title}</title>
      {shape.kind === "path" ? (
        <path d={shape.d} className={className} />
      ) : null}
      {shape.kind === "rect" ? (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
          className={className}
        />
      ) : null}
      {shape.kind === "ellipse" ? (
        <ellipse
          cx={shape.cx}
          cy={shape.cy}
          rx={shape.rx}
          ry={shape.ry}
          transform={makeTransform(shape)}
          className={className}
        />
      ) : null}
    </g>
  );
}

function MuscleFigure({
  side,
  title,
  coverageByMuscle,
  maxTotalSets,
}: {
  readonly side: BodySide;
  readonly title: string;
  readonly coverageByMuscle: Map<HeatMapMuscle, MuscleCoverage>;
  readonly maxTotalSets: number;
}) {
  const titleId = `muscle-heat-map-${side}`;

  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <svg
        viewBox="0 0 120 330"
        role="img"
        aria-labelledby={titleId}
        className="mx-auto h-[330px] w-full max-w-[190px]"
      >
        <title id={titleId}>{title} muscle heat map</title>
        <BodyGuide />
        {MUSCLE_SHAPES.filter((shape) => shape.side === side).map((shape, index) => (
          <MuscleZone
            key={`${side}-${shape.muscle}-${index}`}
            shape={shape}
            coverage={coverageByMuscle.get(shape.muscle)}
            maxTotalSets={maxTotalSets}
          />
        ))}
      </svg>
    </div>
  );
}

function MuscleCoverageTile({
  muscle,
  maxTotalSets,
}: {
  readonly muscle: MuscleCoverage;
  readonly maxTotalSets: number;
}) {
  const tone = getHeatTone(muscle.totalSets, maxTotalSets);

  return (
    <div
      className={cn("rounded-md border p-3 text-sm", tone.tileClass)}
      data-testid={`muscle-tile-${muscle.muscle}`}
      title={`${muscle.label}: ${tone.label}`}
    >
      <div className="flex min-h-10 items-start justify-between gap-2">
        <p className="font-semibold leading-tight text-foreground">{muscle.label}</p>
        <span className="shrink-0 rounded-full border border-current/20 px-2 py-0.5 text-[11px] leading-5 text-muted-foreground">
          {getFreshnessLabel(muscle.daysSince)}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("h-2.5 w-2.5 rounded-sm", tone.swatchClass)} aria-hidden="true" />
        <span>{tone.label}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatCount(muscle.totalSets, "set", "sets")} - {formatCount(muscle.sessionCount, "session", "sessions")}
      </p>
    </div>
  );
}

export function MuscleHeatMapCard({
  muscles,
}: Readonly<{ muscles: TrainingOverview["muscleGroupCoverage"] }>) {
  const maxTotalSets = Math.max(1, ...muscles.map((muscle) => muscle.totalSets));
  const analysis = useMemo(() => buildMuscleHeatMapAnalysis(muscles), [muscles]);
  const coverageByMuscle = useMemo(
    () => new Map(muscles.map((muscle) => [muscle.muscle, muscle])),
    [muscles],
  );
  const musclesByRegion = useMemo(() => {
    const grouped = {
      upper: [] as MuscleCoverage[],
      core: [] as MuscleCoverage[],
      lower: [] as MuscleCoverage[],
    };
    for (const muscle of muscles) grouped[muscle.bodyRegion].push(muscle);
    return grouped;
  }, [muscles]);

  if (muscles.length === 0) return null;

  return (
    <Card data-testid="muscle-heat-map-card">
      <CardHeader>
        <CardTitle as="h2" className="text-base">Muscle Heat Map</CardTitle>
        <CardDescription>Set-volume coverage by trained muscle group</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <CoverageAnalysisPanel
          balances={analysis.balances}
          balanceGridClassName="grid grid-cols-1 gap-3 lg:grid-cols-2"
          metricGridClassName="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
          metrics={analysis.metrics}
          nextFocus={analysis.nextFocus}
          nextFocusTestId="muscle-heat-map-next-focus"
          testId="muscle-heat-map-analysis"
          totalSets={analysis.totalSets}
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)]">
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1"
            data-testid="muscle-heat-map-silhouette"
          >
            <MuscleFigure
              side="front"
              title="Front"
              coverageByMuscle={coverageByMuscle}
              maxTotalSets={maxTotalSets}
            />
            <MuscleFigure
              side="back"
              title="Back"
              coverageByMuscle={coverageByMuscle}
              maxTotalSets={maxTotalSets}
            />
          </div>
          <div className="space-y-4" data-testid="muscle-heat-map-grid">
            {Object.entries(REGION_LABELS).map(([region, label]) => (
              <section key={region} aria-labelledby={`muscle-region-${region}`}>
                <h3 id={`muscle-region-${region}`} className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {musclesByRegion[region as keyof typeof musclesByRegion].map((muscle) => (
                    <MuscleCoverageTile
                      key={muscle.muscle}
                      muscle={muscle}
                      maxTotalSets={maxTotalSets}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>Less</span>
          {HEAT_TONES.map((tone) => (
            <span
              key={tone.label}
              className={cn("h-3 w-3 rounded-sm", tone.swatchClass)}
              title={tone.label}
              aria-label={tone.label}
            />
          ))}
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  );
}
