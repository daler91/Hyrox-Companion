import { describe, expect, it } from "vitest";

import { downsampleStravaStreams, parseStravaStreamResponse } from "./downsample";
import { streamFromStretches } from "./testFixtures";

describe("parseStravaStreamResponse", () => {
  it("flattens the key_by_type body and ignores series it did not ask for", () => {
    expect(
      parseStravaStreamResponse({
        time: { data: [0, 1], series_type: "time", original_size: 2 },
        heartrate: { data: [140, 141] },
        latlng: { data: [[1, 2]] },
        moving: { data: [true, false] },
      }),
    ).toEqual({ time: [0, 1], heartrate: [140, 141], moving: [true, false] });
  });

  it("drops malformed series instead of passing them on", () => {
    expect(
      parseStravaStreamResponse({
        time: { data: [0, "1"] },
        heartrate: { data: null },
        moving: { data: [1, 0] },
      }),
    ).toEqual({});
    expect(parseStravaStreamResponse(null)).toEqual({});
    expect(parseStravaStreamResponse([])).toEqual({});
  });
});

describe("downsampleStravaStreams", () => {
  it("folds a 1 Hz hour into 15 s buckets of HR, distance and moving time", () => {
    const stream = streamFromStretches([{ seconds: 3600, paceSecPerKm: 300, hr: 140 }]);
    const { status, samples } = downsampleStravaStreams(stream);

    expect(status).toBe("ok");
    expect(samples?.bucketSeconds).toBe(15);
    expect(samples?.hr).toHaveLength(240);
    expect(samples?.hr[10]).toBe(140);
    // 15 s at 5:00/km is 50 m.
    expect(samples?.dist[10]).toBe(50);
    expect(samples?.mov[10]).toBe(15);
    expect(samples?.has).toEqual({ hr: true, distance: true });
    expect(samples?.truncated).toBe(false);
  });

  it("weights irregular smart-recording samples by the time each covered", () => {
    // Samples 3 s apart, HR alternating: a time-weighted mean is still the midpoint.
    const time = Array.from({ length: 101 }, (_, i) => i * 3);
    const heartrate = time.map((_, i) => (i % 2 === 0 ? 150 : 160));
    const velocity = time.map(() => 3);
    const { samples } = downsampleStravaStreams({ time, heartrate, velocity_smooth: velocity });

    const hr = samples?.hr.filter((value): value is number => value !== null) ?? [];
    expect(hr.every((value) => value >= 150 && value <= 160)).toBe(true);
    const moving = samples?.mov.reduce((sum, value) => sum + value, 0);
    expect(moving).toBe(300);
    // No distance stream: speed × time stands in for it.
    expect(samples?.dist.reduce((sum, value) => sum + value, 0)).toBe(900);
  });

  it("treats a long gap between samples as a pause, not running", () => {
    const time = [0, 1, 2, 3, 200, 201, 202];
    const velocity = time.map(() => 3);
    const heartrate = time.map(() => 150);
    const { samples, status } = downsampleStravaStreams({
      time: [...time, ...Array.from({ length: 120 }, (_, i) => 203 + i)],
      velocity_smooth: [...velocity, ...Array.from({ length: 120 }, () => 3)],
      heartrate: [...heartrate, ...Array.from({ length: 120 }, () => 150)],
    });
    expect(status).toBe("ok");
    const moving = samples?.mov.reduce((sum, value) => sum + value, 0);
    // 3 s before the gap + 2 + 120 after it; the 197 s gap adds nothing.
    expect(moving).toBe(125);
  });

  it("drops implausible HR readings and leaves thin buckets without HR", () => {
    const stream = streamFromStretches([{ seconds: 300, paceSecPerKm: 330, hr: 145 }]);
    // Strap dropout: the second bucket reads zero, the third reads 250.
    for (let i = 15; i < 30; i++) stream.heartrate![i] = 0;
    for (let i = 30; i < 45; i++) stream.heartrate![i] = 250;
    const { samples } = downsampleStravaStreams(stream);
    expect(samples?.hr[0]).toBe(145);
    expect(samples?.hr[1]).toBeNull();
    expect(samples?.hr[2]).toBeNull();
    expect(samples?.hr[3]).toBe(145);
  });

  it("keeps pace-only recordings as no_heartrate", () => {
    const stream = streamFromStretches([{ seconds: 1200, paceSecPerKm: 330 }], { hr: false });
    const { status, samples } = downsampleStravaStreams(stream);
    expect(status).toBe("no_heartrate");
    expect(samples?.has).toEqual({ hr: false, distance: true });
    expect(samples?.hr.every((value) => value === null)).toBe(true);
  });

  it("counts a recording with neither moving nor speed streams as all moving", () => {
    const time = Array.from({ length: 600 }, (_, i) => i);
    const { status, samples } = downsampleStravaStreams({ time, heartrate: time.map(() => 150) });
    expect(status).toBe("ok");
    expect(samples?.has.distance).toBe(false);
    expect(samples?.mov.reduce((sum, value) => sum + value, 0)).toBe(599);
  });

  it("reports unavailable for a missing clock, a stub, or a series that does not line up", () => {
    expect(downsampleStravaStreams({}).status).toBe("unavailable");
    expect(downsampleStravaStreams({ time: [0] }).status).toBe("unavailable");
    // Under a minute of movement is not a session.
    expect(downsampleStravaStreams(streamFromStretches([{ seconds: 40, paceSecPerKm: 300, hr: 140 }])).status).toBe(
      "unavailable",
    );
    // A heart-rate series of the wrong length is ignored rather than misaligned.
    const stream = streamFromStretches([{ seconds: 600, paceSecPerKm: 300, hr: 140 }]);
    stream.heartrate = stream.heartrate?.slice(1);
    expect(downsampleStravaStreams(stream).status).toBe("no_heartrate");
  });

  it("caps a very long recording at six hours of buckets and flags it", () => {
    const stream = streamFromStretches([{ seconds: 6 * 3600 + 600, paceSecPerKm: 420, hr: 130 }]);
    const { samples } = downsampleStravaStreams(stream);
    expect(samples?.hr).toHaveLength(1440);
    expect(samples?.truncated).toBe(true);
  });
});
