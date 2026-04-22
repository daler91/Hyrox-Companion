import { describe, expect, it } from "vitest";

import { formatPrescription, type PrescriptionInput } from "./formatPrescription";

const base: PrescriptionInput = {
  setCount: 2,
  metricValue: 6,
  metricSuffix: "reps",
  metricVaries: false,
  weightValue: 150,
  weightUnit: "lb",
  weightVaries: false,
  hasWeight: true,
};

describe("formatPrescription", () => {
  it("formats a uniform reps + load row", () => {
    const p = formatPrescription(base);
    expect(p.visual).toEqual([
      { text: "2" },
      { text: "6 reps", separator: "times" },
      { text: "150 lb", separator: "dot" },
    ]);
    expect(p.aria).toBe("2 sets of 6 reps at 150 lb");
  });

  it("pluralises sets correctly for a single set", () => {
    const p = formatPrescription({ ...base, setCount: 1 });
    expect(p.aria).toBe("1 set of 6 reps at 150 lb");
  });

  it("renders a varying metric as 'varies'", () => {
    const p = formatPrescription({ ...base, metricVaries: true, metricValue: null });
    expect(p.visual[1]).toEqual({ text: "varies", separator: "times" });
    expect(p.aria).toBe("2 sets of varies at 150 lb");
  });

  it("renders a varying load as 'load varies'", () => {
    const p = formatPrescription({ ...base, weightVaries: true, weightValue: null });
    expect(p.visual[2]).toEqual({ text: "load varies", separator: "dot" });
    expect(p.aria).toBe("2 sets of 6 reps at load varies");
  });

  it("omits the load segment when the exercise has no weight field", () => {
    const p = formatPrescription({
      ...base,
      hasWeight: false,
      weightValue: null,
      metricValue: 1000,
      metricSuffix: "m",
    });
    expect(p.visual).toEqual([
      { text: "2" },
      { text: "1000 m", separator: "times" },
    ]);
    expect(p.aria).toBe("2 sets of 1000 m");
  });

  it("omits the load segment when weight is null but the field is allowed", () => {
    const p = formatPrescription({
      ...base,
      weightValue: null,
      metricValue: 25,
      metricSuffix: "m",
    });
    expect(p.visual).toEqual([
      { text: "2" },
      { text: "25 m", separator: "times" },
    ]);
    expect(p.aria).toBe("2 sets of 25 m");
  });

  it("omits the metric segment when the metric value is missing", () => {
    const p = formatPrescription({ ...base, metricValue: null });
    expect(p.visual).toEqual([
      { text: "2" },
      { text: "150 lb", separator: "dot" },
    ]);
    expect(p.aria).toBe("2 sets at 150 lb");
  });

  it("handles a time-based exercise", () => {
    const p = formatPrescription({
      ...base,
      metricValue: 5,
      metricSuffix: "min",
      hasWeight: false,
      weightValue: null,
    });
    expect(p.visual).toEqual([
      { text: "2" },
      { text: "5 min", separator: "times" },
    ]);
    expect(p.aria).toBe("2 sets of 5 min");
  });

  it("returns only the sets segment when everything else is missing", () => {
    const p = formatPrescription({
      ...base,
      metricValue: null,
      hasWeight: false,
      weightValue: null,
    });
    expect(p.visual).toEqual([{ text: "2" }]);
    expect(p.aria).toBe("2 sets");
  });
});
