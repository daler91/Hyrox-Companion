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

export function parseBackfillFlags(argv: string[]): BackfillFlags {
  const flags: BackfillFlags = { apply: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") flags.apply = true;
    else if (argv[i] === "--user-id") flags.userId = argv[++i];
    else if (argv[i] === "--quiet") flags.quiet = true;
  }
  return flags;
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
export function runBackfill(main: (flags: BackfillFlags) => Promise<void>): void {
  main(parseBackfillFlags(process.argv.slice(2)))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`Backfill failed: ${err instanceof Error ? err.stack : String(err)}\n`);
      process.exit(1);
    });
}
