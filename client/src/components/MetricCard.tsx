import type { LucideIcon } from "lucide-react";
import { Minus,TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface MetricCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon: LucideIcon;
}

// Screen-reader description for trend direction so the information isn't
// conveyed by color alone (WCAG 1.4.1, W8).
function trendLabelFor(trend: MetricCardProps["trend"]): string {
  if (trend === "up") return "trending up";
  if (trend === "down") return "trending down";
  return "no change";
}

export function MetricCard({ title, value, unit, trend, trendValue, icon: Icon }: Readonly<MetricCardProps>) {
  const trendLabel = trendLabelFor(trend);

  const getTrendIcon = () => {
    if (trend === "up") return <TrendingUp aria-hidden="true" className="h-4 w-4 text-green-500" />;
    if (trend === "down") return <TrendingDown aria-hidden="true" className="h-4 w-4 text-red-500" />;
    return <Minus aria-hidden="true" className="h-4 w-4 text-muted-foreground" />;
  };

  const getTrendColor = () => {
    if (trend === "up") return "text-green-500";
    if (trend === "down") return "text-red-500";
    return "text-muted-foreground";
  };

  return (
    <Card data-testid={`card-metric-${title.toLowerCase().replaceAll(/\s/g, "-")}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground truncate">
              {title}
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-mono font-bold">{value}</span>
              {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
            </div>
            {trend && trendValue && (
              <div
                className="flex items-center gap-1 mt-2"
                aria-label={`${trendLabel}, ${trendValue}`}
              >
                {getTrendIcon()}
                <span className={`text-sm ${getTrendColor()}`}>{trendValue}</span>
              </div>
            )}
          </div>
          <div className="flex-shrink-0 p-3 bg-primary/10 rounded-lg">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
