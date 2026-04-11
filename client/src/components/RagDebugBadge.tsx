import { ChevronDown, ChevronRight, Database, FileText } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useState } from "react";

import type { RagInfo } from "@/hooks/useChatSession";

const BADGE_COLORS: Record<RagInfo["source"], string> = {
  rag: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800",
  legacy: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800",
  none: "text-muted-foreground bg-muted border-border",
};

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface BadgeConfig {
  label: string;
  icon: LucideIcon;
  color: string;
  chunks?: string[];
  ariaSuffix: string;
  testId?: string;
}

function getDevBadgeLabel(ragInfo: RagInfo): string {
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
  const noun = count === 1 ? "source" : "sources";
  return `Cited ${count} ${noun}`;
}

function buildProductionConfig(ragInfo: RagInfo): BadgeConfig | null {
  const label = getProductionLabel(ragInfo);
  if (!label) return null;
  return {
    label,
    icon: Database,
    color: BADGE_COLORS.rag,
    chunks: ragInfo.chunks,
    ariaSuffix: "coaching sources",
    testId: "button-rag-citations",
  };
}

function buildDevConfig(ragInfo: RagInfo): BadgeConfig {
  const chunks = ragInfo.source === "rag" ? ragInfo.chunks : undefined;
  return {
    label: getDevBadgeLabel(ragInfo),
    icon: ragInfo.source === "rag" ? Database : FileText,
    color: BADGE_COLORS[ragInfo.source],
    chunks,
    ariaSuffix: "details",
  };
}

interface RagBadgeViewProps {
  config: BadgeConfig;
}

function RagBadgeView({ config }: Readonly<RagBadgeViewProps>) {
  const [expanded, setExpanded] = useState(false);
  const { label, icon: Icon, color, chunks, ariaSuffix, testId } = config;
  const hasExpandableChunks = !!chunks && chunks.length > 0;
  const expandVerb = expanded ? "collapse" : "expand";

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${label} – ${expandVerb} ${ariaSuffix}`}
        data-testid={testId}
        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${color} hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <Icon className="h-2.5 w-2.5" />
        {label}
        {hasExpandableChunks && expanded ? <ChevronDown className="h-2.5 w-2.5" /> : null}
        {hasExpandableChunks && !expanded ? <ChevronRight className="h-2.5 w-2.5" /> : null}
      </button>
      {expanded && hasExpandableChunks ? (
        <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
          {chunks.map((chunk) => (
            <div
              key={`chunk-${chunk.slice(0, 40)}`}
              className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 border border-border/50"
            >
              {chunk.length > 200 ? `${chunk.slice(0, 200)}...` : chunk}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RagDebugBadge({ ragInfo }: Readonly<{ ragInfo: RagInfo }>) {
  // Production: show an athlete-facing "Cited N sources" chip only when the
  // response actually used RAG. Legacy/none paths stay in dev-only mode.
  if (import.meta.env.PROD) {
    const config = buildProductionConfig(ragInfo);
    if (!config) return null;
    return <RagBadgeView config={config} />;
  }

  // Development: show the full debug view with all three source types.
  return <RagBadgeView config={buildDevConfig(ragInfo)} />;
}
