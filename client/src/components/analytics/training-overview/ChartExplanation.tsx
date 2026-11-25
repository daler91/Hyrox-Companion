import { ChevronDown, Sparkles } from "lucide-react";
import { lazy, Suspense, useState } from "react";

/** The explanation as plain text: while the markdown chunk loads, and if it cannot. */
function PlainExplanation({ content }: { readonly content: string }) {
  return <p className="whitespace-pre-wrap">{content}</p>;
}

// ⚡ Bolt: the markdown stack (react-markdown + rehype-sanitize, ~122 kB raw /
// ~37 kB gzip) is its own chunk, loaded only when an explanation is rendered.
// Every Overview chart card imports this component, so a static import put the
// stack in the /analytics route's static closure even for athletes who have
// never generated an analysis. A chunk that fails to load (a tab left open
// across a deploy) falls back to plain text, as NutritionInsightsPanel does.
const ChartExplanationMarkdown = lazy(() =>
  import("./ChartExplanationMarkdown").catch(() => ({ default: PlainExplanation })),
);

interface ChartExplanationProps {
  readonly explanation?: string;
}

/**
 * "What this means for you" shown inside an Overview chart card — expanded by
 * default, collapsible via the toggle. It renders the AI's per-chart reading as
 * sanitized Markdown (see ChartExplanationMarkdown, loaded lazily).
 *
 * Renders nothing when there's no explanation (e.g. before the athlete has
 * generated the analysis, or for a chart that had no section), so it's safe to
 * drop into every chart card unconditionally.
 */
export function ChartExplanation({ explanation }: ChartExplanationProps) {
  const [open, setOpen] = useState(true);
  if (!explanation) return null;

  return (
    <div className="mt-3 border-t pt-3" data-testid="chart-explanation">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 text-sm font-medium text-primary rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={open}
        data-testid="chart-explanation-toggle"
      >
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>What this means for you</span>
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          className="prose prose-sm dark:prose-invert mt-2 max-w-none prose-p:my-1.5"
          data-testid="chart-explanation-content"
        >
          <Suspense fallback={<PlainExplanation content={explanation} />}>
            <ChartExplanationMarkdown content={explanation} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
