/**
 * The report `script/chat-quality-report.ts` prints, from the counts it reads,
 * and its one flag (AI coach chat review, I23). Pure, so the wording and the
 * rates are tested without a database.
 */

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

/** `--days N`, from 1 to a year; the default otherwise. */
export function parseDays(argv: readonly string[]): number {
  const index = argv.indexOf("--days");
  const days = index === -1 ? DEFAULT_DAYS : Number(argv[index + 1]);
  return Number.isInteger(days) && days >= 1 && days <= MAX_DAYS ? days : DEFAULT_DAYS;
}

/** Proposals drafted in the window, by what became of them. */
export interface ProposalCounts {
  readonly pending: number;
  readonly applied: number;
  /** Applied with only some of their changes picked. */
  readonly partlyApplied: number;
  readonly dismissed: number;
  readonly superseded: number;
  readonly invalidated: number;
  /** Applied, then undone. */
  readonly reverted: number;
}

/** The coach's replies in the window, and the athletes' thumbs on them. */
export interface FeedbackCounts {
  readonly replies: number;
  readonly up: number;
  readonly down: number;
}

export interface ChatQualityStats {
  readonly days: number;
  readonly proposals: ProposalCounts;
  readonly feedback: FeedbackCounts;
}

/** "12 (40%)", or the bare count when there is nothing to divide by. */
function share(count: number, of: number): string {
  if (of === 0) return String(count);
  return `${count} (${Math.round((count / of) * 100)}%)`;
}

function line(label: string, value: string, indent = 2): string {
  return `${" ".repeat(indent)}${label.padEnd(44 - indent)} ${value}`;
}

export function formatChatQualityReport({ days, proposals, feedback }: ChatQualityStats): string {
  // A reverted proposal was applied first, so it counts as applied too.
  const everApplied = proposals.applied + proposals.reverted;
  const drafted = everApplied + proposals.pending + proposals.dismissed + proposals.superseded + proposals.invalidated;
  const rated = feedback.up + feedback.down;
  return [
    "",
    `Coach chat quality — the last ${days} day${days === 1 ? "" : "s"}`,
    "",
    line("Plan proposals drafted", String(drafted), 0),
    line("applied (all or some changes)", share(everApplied, drafted)),
    line("only some changes", String(proposals.partlyApplied), 4),
    line("undone afterwards", share(proposals.reverted, everApplied), 4),
    line("dismissed", share(proposals.dismissed, drafted)),
    line("out of date before applied", share(proposals.invalidated, drafted)),
    line("replaced by a newer proposal", share(proposals.superseded, drafted)),
    line("still waiting", share(proposals.pending, drafted)),
    "",
    line("Coach replies", String(feedback.replies), 0),
    line("rated", share(rated, feedback.replies)),
    line("helpful", share(feedback.up, rated), 4),
    line("not helpful", share(feedback.down, rated), 4),
    "",
    "Timings, the plan-edit classifier's decisions, tool calls and regenerates are in the `[chat] turn` log line.",
    "",
  ].join("\n");
}
