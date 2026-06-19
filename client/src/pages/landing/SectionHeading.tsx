import type { LucideIcon } from "lucide-react";

type EyebrowProps = Readonly<{
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}>;

export function Eyebrow({ icon: Icon, children, className = "" }: EyebrowProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-primary ${className}`}
    >
      {Icon ? (
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

type SectionHeadingProps = Readonly<{
  eyebrow?: string;
  eyebrowIcon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}>;

/**
 * Shared section header so every landing section keeps the same rhythm.
 * Emits the eyebrow, h2, and lede as siblings of one container; the h2 and
 * lede carry `fade-up` so the IntersectionObserver stagger in Landing.tsx
 * (scoped per-parent via nth-child) animates them just like before.
 */
export function SectionHeading({
  eyebrow,
  eyebrowIcon,
  title,
  description,
  align = "center",
  className = "",
}: SectionHeadingProps) {
  const isCenter = align === "center";
  return (
    <div
      className={`${isCenter ? "text-center" : "text-left"} mb-12 md:mb-16 ${className}`}
    >
      {eyebrow ? (
        <div className="fade-up mb-4">
          <Eyebrow icon={eyebrowIcon}>{eyebrow}</Eyebrow>
        </div>
      ) : null}
      <h2 className="fade-up font-heading text-3xl md:text-4xl font-bold tracking-tight">
        {title}
      </h2>
      {description ? (
        <p
          className={`fade-up mt-4 text-lg text-muted-foreground ${isCenter ? "max-w-2xl mx-auto" : "max-w-2xl"}`}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
