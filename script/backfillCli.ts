/**
 * The shared skeleton of a one-off backfill script.
 *
 * Every backfill in here answers the same three questions the same way — am I
 * writing or rehearsing, one athlete or all of them, and how loud — so they had
 * all grown an identical `Flags` + `parseFlags` + output pair. Three copies of
 * a flag parser is three places for `--apply` to mean something subtly
 * different, which is the last thing a script that mutates athletes' history
 * should risk.
 *
 * Output goes to stdout/stderr rather than the app logger. An operator watching
 * a migration wants readable lines, not pino JSON — and it keeps these files
 * clear of `javascript_lang_logger_leak`, which fires on any non-string-literal
 * argument to a `log`/`logger`/`console` call regardless of whether the data is
 * sensitive.
 */

export interface BackfillFlags {
  /** Write. Without it a backfill rehearses and changes nothing. */
  apply: boolean;
  /** Restrict to one athlete. */
  userId?: string;
  /** Summary only; skip the per-row detail. */
  quiet: boolean;
}

/**
 * Parse the shared backfill flags. Strict on purpose — D29
 * (CODEBASE_ANALYSIS_2026-10-03): a `--user-id=X` that was silently dropped
 * turned a one-athlete `--apply` rehearsal into a run over every athlete. So
 * `--user-id` takes `--user-id X` or `--user-id=X`, a missing value throws,
 * and so does any flag or argument this parser does not know.
 *
 * `extraValueFlags` names script-specific flags that take one value
 * (`--revert <file>`); they are stepped over here and read by the script.
 */
export function parseBackfillFlags(
  argv: readonly string[],
  extraValueFlags: readonly string[] = [],
): BackfillFlags {
  const flags: BackfillFlags = { apply: false, quiet: false };
  const args = argv[Symbol.iterator]();
  for (let next = args.next(); !next.done; next = args.next()) {
    const arg = next.value;
    if (arg === "--apply") flags.apply = true;
    else if (arg === "--quiet") flags.quiet = true;
    else if (arg === "--user-id") flags.userId = requireValue(arg, args.next().value);
    else if (arg.startsWith("--user-id=")) {
      flags.userId = requireValue("--user-id", arg.slice("--user-id=".length));
    } else if (extraValueFlags.includes(arg)) args.next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return flags;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

/** One line of operator-facing report. */
export function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Run a backfill's body, and make a failure loud.
 *
 * A data migration that dies without saying why is the one that cannot be
 * diagnosed, so the stack goes to stderr and the exit code is non-zero — the
 * two things a shell script wrapping this would check.
 */
export function runBackfill(
  main: (flags: BackfillFlags) => Promise<void>,
  extraValueFlags: readonly string[] = [],
): void {
  Promise.resolve()
    .then(() => main(parseBackfillFlags(process.argv.slice(2), extraValueFlags)))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`Backfill failed: ${err instanceof Error ? err.stack : String(err)}\n`);
      process.exit(1);
    });
}
