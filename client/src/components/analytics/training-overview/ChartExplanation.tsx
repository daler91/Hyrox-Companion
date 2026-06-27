import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

interface ChartExplanationProps {
  readonly explanation?: string;
}

/**
 * Collapsible "What this means for you" shown inside an Overview chart card. It
 * renders the AI's per-chart reading as sanitized Markdown — rehype-sanitize
 * strips script tags, event handlers and javascript:/data: URLs so a compromised
 * provider or a prompt-injection attempt can't run JS in the user's session.
 *
 * Renders nothing when there's no explanation (e.g. before the athlete has
 * generated the analysis, or for a chart that had no section), so it's safe to
 * drop into every chart card unconditionally.
 */
export function ChartExplanation({ explanation }: ChartExplanationProps) {
  const [open, setOpen] = useState(false);
  if (!explanation) return null;

  return (
    <div className="mt-3 border-t pt-3" data-testid="chart-explanation">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 text-sm font-medium text-primary"
        aria-expanded={open}
        data-testid="chart-explanation-toggle"
      >
        <Sparkles className="h-4 w-4 shrink-0" />
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
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{explanation}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
