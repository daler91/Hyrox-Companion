import { CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { featureFlags } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

import { type Feature, FEATURES } from "./landingCopy";
import { SectionHeading } from "./SectionHeading";

const SOCIAL_PROOF: string[] = [
  "200+ Exercises",
  "Strava & Garmin Sync",
  "AI-Powered Coaching",
  "Session Grading",
  "Missed-Session Recovery",
  "Voice & Photo Logging",
  ...(featureFlags.nutritionEnabled ? ["Nutrition & Macros"] : []),
];

export function SocialProof() {
  return (
    <section className="py-12 border-y bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {SOCIAL_PROOF.map((label) => (
            <div
              key={label}
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3.5 py-1.5"
            >
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              <span className="text-sm font-medium tabular-nums">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature, wide }: Readonly<{ feature: Feature; wide: boolean }>) {
  const { icon: Icon, highlightIcon: HighlightIcon } = feature;
  return (
    <Card
      className={cn(
        "fade-up hover-elevate group relative border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]",
        wide && "md:col-span-2",
      )}
    >
      <CardContent className="p-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/15 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/25 transition-colors">
          <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-heading font-semibold text-lg mb-2 flex flex-wrap items-center gap-2">
            {feature.title}
            {feature.isNew ? (
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border-0">
                New
              </Badge>
            ) : null}
          </h3>
          <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
          <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
            <HighlightIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {feature.highlight}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Features() {
  // Stretch a lone last card across both columns so the grid never ends with a gap.
  const hasOrphan = FEATURES.length % 2 === 1;
  return (
    <section id="features" className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <SectionHeading
          eyebrow="Features"
          title="Everything You Need to Train Smarter"
          description="From plans built on your own numbers to sessions graded against their purpose, every tool adapts to your training."
        />
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {FEATURES.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              wide={hasOrphan && index === FEATURES.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
