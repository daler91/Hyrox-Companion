export interface PrescriptionInput {
  readonly setCount: number;
  readonly metricValue: number | null;
  readonly metricSuffix: string;
  readonly metricVaries: boolean;
  readonly weightValue: number | null;
  readonly weightUnit: "kg" | "lb";
  readonly weightVaries: boolean;
  readonly hasWeight: boolean;
}

export type VisualSeparator = "times" | "dot";

export interface VisualSegment {
  readonly text: string;
  readonly separator?: VisualSeparator;
}

export interface Prescription {
  readonly visual: readonly VisualSegment[];
  readonly aria: string;
}

// Produces the mobile collapsed-row summary, e.g. "2 × 6 reps · 150 lb".
// Visual glyphs (× and ·) are returned as separator metadata so the
// caller can wrap them in aria-hidden spans; screen readers get the
// grammatical aria string instead ("2 sets of 6 reps at 150 lb").
export function formatPrescription(input: PrescriptionInput): Prescription {
  const visual: VisualSegment[] = [{ text: String(input.setCount) }];
  const ariaParts: string[] = [pluralizeSets(input.setCount)];

  const metric = metricSegment(input);
  if (metric) {
    visual.push({ text: metric.visual, separator: "times" });
    ariaParts.push(`of ${metric.aria}`);
  }

  const load = loadSegment(input);
  if (load) {
    visual.push({ text: load.visual, separator: "dot" });
    ariaParts.push(`at ${load.aria}`);
  }

  return { visual, aria: ariaParts.join(" ") };
}

function pluralizeSets(count: number): string {
  return `${count} ${count === 1 ? "set" : "sets"}`;
}

function metricSegment(
  input: PrescriptionInput,
): { visual: string; aria: string } | null {
  if (input.metricVaries) return { visual: "varies", aria: "varies" };
  if (input.metricValue == null || input.metricValue === 0) return null;
  const text = `${input.metricValue} ${input.metricSuffix}`;
  return { visual: text, aria: text };
}

function loadSegment(
  input: PrescriptionInput,
): { visual: string; aria: string } | null {
  if (!input.hasWeight) return null;
  if (input.weightVaries) return { visual: "load varies", aria: "load varies" };
  if (input.weightValue == null) return null;
  const text = `${input.weightValue} ${input.weightUnit}`;
  return { visual: text, aria: text };
}
