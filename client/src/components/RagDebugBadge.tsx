import { ChevronDown, ChevronRight,Database, FileText } from "lucide-react";
import { useState } from "react";

import type { RagInfo } from "@/hooks/useChatSession";

const BADGE_COLORS: Record<RagInfo["source"], string> = {
  rag: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800",
  legacy: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800",
  none: "text-muted-foreground bg-muted border-border",
};

function getBadgeLabel(ragInfo: RagInfo): string {
  if (ragInfo.source === "rag") return `RAG: ${ragInfo.chunkCount} chunks`;
  if (ragInfo.source === "legacy") {
    const reason = ragInfo.fallbackReason ? ` (${ragInfo.fallbackReason})` : "";
    return `Legacy: ${ragInfo.materialCount ?? 0} materials${reason}`;
  }
  return "No coaching data";
}

function getProductionLabel(ragInfo: RagInfo): string | null {
  // In production we only surface a citation affordance when the suggestion
  // actually cited RAG chunks from the user's uploaded coaching materials.
  // Legacy / none paths are debug-only.
  if (ragInfo.source !== "rag") return null;
  const count = ragInfo.chunkCount ?? ragInfo.chunks?.length ?? 0;
  if (count === 0) return null;
  return `Cited ${count} source${count === 1 ? "" : "s"}`;
}

export function RagDebugBadge({ ragInfo }: Readonly<{ ragInfo: RagInfo }>) {
  const [expanded, setExpanded] = useState(false);

  // Production: show an athlete-facing "Cited N sources" chip that expands
  // the chunks inline. Hidden entirely when the response didn't use RAG.
  if (import.meta.env.PROD) {
    const prodLabel = getProductionLabel(ragInfo);
    if (!prodLabel) return null;
    const badgeColor = BADGE_COLORS.rag;
    const hasExpandableChunks = ragInfo.chunks && ragInfo.chunks.length > 0;

    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`${prodLabel} – ${expanded ? "collapse" : "expand"} coaching sources`}
          data-testid="button-rag-citations"
          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${badgeColor} hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          <Database className="h-2.5 w-2.5" />
          {prodLabel}
          {hasExpandableChunks ? (
            expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />
          ) : null}
        </button>
        {expanded && hasExpandableChunks ? (
          <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
            {ragInfo.chunks!.map((chunk) => (
              <div
                key={`chunk-${chunk.slice(0, 40)}`}
                className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 border border-border/50"
              >
                {chunk.length > 200 ? chunk.slice(0, 200) + "..." : chunk}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // Development: full debug view with all three source types and reasons.
  const badgeColor = BADGE_COLORS[ragInfo.source];
  const Icon = ragInfo.source === "rag" ? Database : FileText;
  const label = getBadgeLabel(ragInfo);
  const hasExpandableChunks = ragInfo.source === "rag" && ragInfo.chunks && ragInfo.chunks.length > 0;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${label} – ${expanded ? "collapse" : "expand"} details`}
        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${badgeColor} hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <Icon className="h-2.5 w-2.5" />
        {label}
        {hasExpandableChunks && (
          expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />
        )}
      </button>
      {expanded && hasExpandableChunks && (
        <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
          {ragInfo.chunks!.map((chunk) => (
            <div
              key={`chunk-${chunk.slice(0, 40)}`}
              className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 border border-border/50"
            >
              {chunk.length > 200 ? chunk.slice(0, 200) + "..." : chunk}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
