export type AnalysisTone = "good" | "watch" | "gap";

export type CoverageWork = {
  readonly label: string;
  readonly sessionCount: number;
  readonly totalSets: number;
  readonly lastTrained: string | null;
  readonly daysSince: number | null;
};

export type AnalysisMetric = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: AnalysisTone;
};

export type BalanceAnalysis = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone: AnalysisTone;
  readonly recommendation: string | null;
};

export const STALE_AFTER_DAYS = 14;
export const BALANCE_RATIO_THRESHOLD = 1.6;

export function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function formatPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

export function getFreshnessLabel(daysSince: number | null): string {
  if (daysSince === null) return "Never trained";
  if (daysSince === 0) return "Today";
  if (daysSince === 1) return "Yesterday";
  return `${daysSince}d ago`;
}

export function hasCoverageWork(item: CoverageWork): boolean {
  return item.sessionCount > 0 || item.totalSets > 0 || item.lastTrained !== null;
}

export function sumCoverageSets<T extends CoverageWork, K extends string>(
  items: readonly T[],
  targetIds: readonly K[],
  getId: (item: T) => K,
): number {
  return items.reduce(
    (sum, item) => sum + (targetIds.includes(getId(item)) ? item.totalSets : 0),
    0,
  );
}

export function findTopCoverage<T extends CoverageWork>(items: readonly T[]): T | null {
  return [...items]
    .filter(hasCoverageWork)
    .sort((a, b) => (
      b.totalSets - a.totalSets ||
      b.sessionCount - a.sessionCount ||
      (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
    ))[0] ?? null;
}

export function findPriorityGap<T extends CoverageWork>(
  items: readonly T[],
  noWorkReason: string,
): { readonly item: T; readonly reason: string } | null {
  const neverTrained = items.find((item) => !hasCoverageWork(item) || item.daysSince === null);
  if (neverTrained) {
    return {
      item: neverTrained,
      reason: noWorkReason,
    };
  }

  const stale = [...items]
    .filter((item) => item.daysSince !== null && item.daysSince > STALE_AFTER_DAYS)
    .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0))[0];
  if (!stale) return null;

  return {
    item: stale,
    reason: `last trained ${getFreshnessLabel(stale.daysSince).toLowerCase()}`,
  };
}

function makeBalanceAnalysis(
  label: string,
  value: string,
  detail: string,
  tone: AnalysisTone,
  recommendation: string | null,
): BalanceAnalysis {
  return { label, value, detail, tone, recommendation };
}

export function buildBalanceAnalysis(
  label: string,
  leftLabel: string,
  leftSets: number,
  rightLabel: string,
  rightSets: number,
): BalanceAnalysis {
  const value = `${formatCount(leftSets, "set", "sets")} / ${formatCount(rightSets, "set", "sets")}`;
  const leftLower = leftLabel.toLowerCase();
  const rightLower = rightLabel.toLowerCase();

  if (leftSets === 0 && rightSets === 0) {
    return makeBalanceAnalysis(
      label,
      value,
      `No ${leftLower} or ${rightLower} volume logged.`,
      "gap",
      `Add ${leftLower} and ${rightLower} exposure before judging this balance.`,
    );
  }

  if (leftSets === 0) {
    return makeBalanceAnalysis(
      label,
      value,
      `Missing ${leftLower} volume.`,
      "gap",
      `Add ${leftLower} work to balance ${rightLower} volume.`,
    );
  }

  if (rightSets === 0) {
    return makeBalanceAnalysis(
      label,
      value,
      `${leftLabel} volume is leading ${rightLower} volume.`,
      "gap",
      `Add ${rightLower} work to balance ${leftLower} volume.`,
    );
  }

  const ratio = leftSets / rightSets;
  if (ratio >= BALANCE_RATIO_THRESHOLD) {
    return makeBalanceAnalysis(
      label,
      value,
      `${leftLabel} volume is leading ${rightLower} volume.`,
      "watch",
      `Add ${rightLower} work before more ${leftLower} volume.`,
    );
  }
  if (ratio <= 1 / BALANCE_RATIO_THRESHOLD) {
    return makeBalanceAnalysis(
      label,
      value,
      `${rightLabel} volume is leading ${leftLower} volume.`,
      "watch",
      `Add ${leftLower} work before more ${rightLower} volume.`,
    );
  }

  return makeBalanceAnalysis(
    label,
    value,
    `${leftLabel} and ${rightLower} volume are balanced.`,
    "good",
    null,
  );
}

function getAnalysisToneClass(tone: AnalysisTone = "watch"): string {
  if (tone === "good") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (tone === "gap") {
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function AnalysisMetricTile({ metric }: Readonly<{ metric: AnalysisMetric }>) {
  return (
    <div className={`rounded-md border p-3 ${getAnalysisToneClass(metric.tone)}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{metric.label}</p>
      <p className="mt-1 text-sm font-semibold leading-tight text-foreground">{metric.value}</p>
      <p className="mt-1 text-xs leading-snug opacity-90">{metric.detail}</p>
    </div>
  );
}

function BalanceTile({ balance }: Readonly<{ balance: BalanceAnalysis }>) {
  return (
    <div className={`rounded-md border p-3 ${getAnalysisToneClass(balance.tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide opacity-80">{balance.label}</p>
        <p className="shrink-0 text-xs font-semibold text-foreground">{balance.value}</p>
      </div>
      <p className="mt-2 text-xs leading-snug opacity-90">{balance.detail}</p>
    </div>
  );
}

export function CoverageAnalysisPanel({
  balances,
  balanceGridClassName,
  metricGridClassName,
  metrics,
  nextFocus,
  nextFocusTestId,
  testId,
  totalSets,
}: Readonly<{
  balances: readonly BalanceAnalysis[];
  balanceGridClassName: string;
  metricGridClassName: string;
  metrics: readonly AnalysisMetric[];
  nextFocus: string;
  nextFocusTestId: string;
  testId: string;
  totalSets: number;
}>) {
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className={metricGridClassName}>
        {metrics.map((metric) => (
          <AnalysisMetricTile key={metric.label} metric={metric} />
        ))}
      </div>
      <div className={balanceGridClassName}>
        {balances.map((balance) => (
          <BalanceTile key={balance.label} balance={balance} />
        ))}
      </div>
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid={nextFocusTestId}>
        <span className="font-semibold">{formatCount(totalSets, "mapped set", "mapped sets")} analyzed. </span>
        <span className="text-muted-foreground">{nextFocus}</span>
      </div>
    </div>
  );
}
