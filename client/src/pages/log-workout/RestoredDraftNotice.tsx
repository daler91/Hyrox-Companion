import { Button } from "@/components/ui/button";
import { getTodayString } from "@/lib/dateUtils";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

interface RestoredDraftNoticeProps {
  /** The form's current date, which the save will use. */
  readonly date: string;
  readonly onUseToday: () => void;
  readonly onDiscard: () => void;
}

/**
 * Sits over a /log form restored from a saved draft. A draft resumes on the
 * step it was left on, and only Capture shows the date, so an abandoned
 * Monday draft finished on Thursday was saved on Monday with nothing on screen
 * saying so, and there was no way to start again. This names the date the
 * save will use on every step, offers today's when it differs, and discards
 * the draft. CL44 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function RestoredDraftNotice({
  date,
  onUseToday,
  onDiscard,
}: Readonly<RestoredDraftNoticeProps>) {
  const isToday = date === getTodayString();
  const dateLabel = date ? formatScheduledDate(date) : "no date";
  return (
    <section
      aria-label="Restored draft"
      className="rounded-md border border-border bg-muted/40 p-3 text-sm"
      data-testid="restored-draft-notice"
    >
      <p>
        Restored your unsaved workout, dated <strong>{dateLabel}</strong>.
        {isToday ? null : " It will be saved on that date."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {isToday ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onUseToday}
            data-testid="button-draft-use-today"
          >
            Use today&apos;s date
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDiscard}
          data-testid="button-discard-draft"
        >
          Discard draft
        </Button>
      </div>
    </section>
  );
}
