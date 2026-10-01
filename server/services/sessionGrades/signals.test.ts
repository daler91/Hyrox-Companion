import { describe, expect, it } from "vitest";

import {
  bucketHr,
  bucketSpeed,
  fasterThanShare,
  hrOver,
  hrShare,
  movingBuckets,
  movingSeconds,
  paceOver,
  pct,
  roundTo,
  splitByMovingTime,
} from "./signals";
import { bucketsFromStretches } from "./testFixtures";

describe("bucketSpeed", () => {
  const steady = bucketsFromStretches([{ seconds: 60, paceSecPerKm: 375, hr: 140 }]);

  it("is metres over moving seconds for a normal running bucket", () => {
    // 375 s/km → 40 m per 15 s bucket.
    expect(bucketSpeed(steady, 0)).toBeCloseTo(40 / 15, 5);
  });

  it("is null when the recording carried no distance", () => {
    const samples = bucketsFromStretches([{ seconds: 60, paceSecPerKm: 375, hr: 140 }], { distance: false });
    expect(bucketSpeed(samples, 0)).toBeNull();
  });

  it("is null for a standing bucket and for an index past the end", () => {
    const samples = bucketsFromStretches([{ seconds: 30 }, { seconds: 30, paceSecPerKm: 375 }]);
    expect(bucketSpeed(samples, 0)).toBeNull();
    expect(bucketSpeed(samples, 99)).toBeNull();
  });

  it("is null when the bucket barely moved", () => {
    const samples = { ...steady, mov: [7, 15, 15, 15] };
    expect(bucketSpeed(samples, 0)).toBeNull();
    expect(bucketSpeed(samples, 1)).not.toBeNull();
  });

  it("rejects speeds outside a runner's band", () => {
    const tooSlow = bucketsFromStretches([{ seconds: 30, paceSecPerKm: 1000 }]); // 1.0 m/s
    const tooFast = bucketsFromStretches([{ seconds: 30, paceSecPerKm: 100 }]); // 10 m/s
    expect(bucketSpeed(tooSlow, 0)).toBeNull();
    expect(bucketSpeed(tooFast, 0)).toBeNull();
  });
});

describe("bucketHr", () => {
  it("returns the bucket HR while moving", () => {
    const samples = bucketsFromStretches([{ seconds: 30, paceSecPerKm: 375, hr: 142 }]);
    expect(bucketHr(samples, 0)).toBe(142);
  });

  it("ignores HR recorded while standing still", () => {
    const samples = bucketsFromStretches([{ seconds: 30, hr: 100 }]);
    expect(bucketHr(samples, 0)).toBeNull();
  });

  it("is null without an HR signal, and for a bucket with no HR value", () => {
    const noHr = bucketsFromStretches([{ seconds: 30, paceSecPerKm: 375, hr: 142 }], { hr: false });
    expect(bucketHr(noHr, 0)).toBeNull();
    const gap = { ...bucketsFromStretches([{ seconds: 30, paceSecPerKm: 375, hr: 142 }]), hr: [null, 142] };
    expect(bucketHr(gap, 0)).toBeNull();
    expect(bucketHr(gap, 1)).toBe(142);
  });
});

describe("movingBuckets / movingSeconds", () => {
  const samples = bucketsFromStretches([
    { seconds: 30, paceSecPerKm: 375, hr: 130 },
    { seconds: 30 },
    { seconds: 15, paceSecPerKm: 375, hr: 130 },
  ]);

  it("lists only buckets with movement", () => {
    expect(movingBuckets(samples)).toEqual([0, 1, 4]);
  });

  it("sums moving seconds over the chosen buckets, skipping unknown indices", () => {
    expect(movingSeconds(samples, [0, 1, 2, 4])).toBe(45);
    expect(movingSeconds(samples, [0, 99])).toBe(15);
    expect(movingSeconds(samples, [])).toBe(0);
  });
});

describe("hrOver / hrShare", () => {
  // 150 s at 130 bpm then 450 s at 150 bpm → time-weighted mean 145.
  const samples = bucketsFromStretches([
    { seconds: 150, paceSecPerKm: 375, hr: 130 },
    { seconds: 450, paceSecPerKm: 375, hr: 150 },
  ]);
  const all = movingBuckets(samples);

  it("weights the mean HR by moving time", () => {
    expect(hrOver(samples, all)).toEqual({ avg: 145, seconds: 600 });
  });

  it("reports no average when nothing carried HR", () => {
    const noHr = bucketsFromStretches([{ seconds: 60, paceSecPerKm: 375 }], { hr: false });
    expect(hrOver(noHr, movingBuckets(noHr))).toEqual({ avg: null, seconds: 0 });
    expect(hrOver(samples, [])).toEqual({ avg: null, seconds: 0 });
  });

  it("counts the moving time matching a predicate against the time that had HR", () => {
    expect(hrShare(samples, all, (hr) => hr > 140)).toEqual({ matched: 450, total: 600 });
    expect(hrShare(samples, all, () => false)).toEqual({ matched: 0, total: 600 });
  });

  it("leaves buckets without HR out of the total", () => {
    const gappy = { ...samples, hr: samples.hr.map((v, i) => (i < 10 ? null : v)) };
    expect(hrShare(gappy, all, () => true)).toEqual({ matched: 450, total: 450 });
  });
});

describe("paceOver / fasterThanShare", () => {
  const samples = bucketsFromStretches([
    { seconds: 300, paceSecPerKm: 300 }, // 50 m per bucket
    { seconds: 300, paceSecPerKm: 400 }, // 37.5 → 38 m per bucket
  ]);
  const all = movingBuckets(samples);

  it("is total moving time over total distance, per km", () => {
    // 600 s over (20 × 50 + 20 × 38) m.
    expect(paceOver(samples, all)).toBeCloseTo((600 / 1760) * 1000, 5);
  });

  it("is null without distance", () => {
    const noDist = bucketsFromStretches([{ seconds: 60, paceSecPerKm: 375 }], { distance: false });
    expect(paceOver(noDist, movingBuckets(noDist))).toBeNull();
  });

  it("splits moving time at a pace cut", () => {
    expect(fasterThanShare(samples, all, 360)).toEqual({ matched: 300, total: 600 });
    expect(fasterThanShare(samples, all, 250)).toEqual({ matched: 0, total: 600 });
  });

  it("ignores buckets with no usable pace", () => {
    const noDist = bucketsFromStretches([{ seconds: 60, paceSecPerKm: 375 }], { distance: false });
    expect(fasterThanShare(noDist, movingBuckets(noDist), 360)).toEqual({ matched: 0, total: 0 });
  });
});

describe("splitByMovingTime", () => {
  it("cuts consecutive chunks of roughly equal moving time", () => {
    const samples = bucketsFromStretches([{ seconds: 120, paceSecPerKm: 375 }]); // 8 buckets
    expect(splitByMovingTime(samples, movingBuckets(samples), 2)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it("never spills past the last chunk and returns empty chunks for no buckets", () => {
    const samples = bucketsFromStretches([{ seconds: 45, paceSecPerKm: 375 }]); // 3 buckets
    const chunks = splitByMovingTime(samples, [0, 1, 2], 3);
    expect(chunks).toEqual([[0], [1], [2]]);
    expect(splitByMovingTime(samples, [], 3)).toEqual([[], [], []]);
  });
});

describe("roundTo / pct", () => {
  it("rounds to the requested decimals", () => {
    expect(roundTo(2.567)).toBe(3);
    expect(roundTo(2.567, 1)).toBe(2.6);
    expect(roundTo(2.567, 2)).toBe(2.57);
  });

  it("gives a whole-number percentage, or null for an empty whole", () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
    expect(pct(0, 0)).toBeNull();
    expect(pct(5, -1)).toBeNull();
  });
});
