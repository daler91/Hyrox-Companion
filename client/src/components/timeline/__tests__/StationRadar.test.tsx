import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildStationRadar, StationRadar } from "../StationRadar";

type Entry = { station: string; lastTrained: string | null; daysSince: number | null };

function entry(station: string, daysSince: number | null): Entry {
  return {
    station,
    lastTrained: daysSince === null ? null : "2026-07-01",
    daysSince,
  };
}

describe("buildStationRadar", () => {
  it("renders nothing before the athlete has trained any station", () => {
    // A fresh athlete shouldn't get nine red chips for things they've never done.
    expect(buildStationRadar([])).toBeNull();
    expect(buildStationRadar([entry("skierg", null), entry("rowing", null)])).toBeNull();
  });

  it("grades a station by how long since it was trained", () => {
    const radar = buildStationRadar([
      entry("skierg", 2),
      entry("rowing", 7),
      entry("wall_balls", 8),
      entry("sled_push", 14),
      entry("sled_pull", 15),
    ]);

    expect(radar?.chips.map((c) => [c.station, c.tone])).toEqual([
      ["skierg", "good"],
      ["rowing", "good"],
      ["wall_balls", "watch"],
      ["sled_push", "watch"],
      ["sled_pull", "gap"],
    ]);
  });

  it("names the coldest station in words", () => {
    const radar = buildStationRadar([entry("skierg", 2), entry("sled_pull", 21)]);
    expect(radar?.headline).toBe("Sled Pull is coldest — 21d ago.");
  });

  it("ranks a never-trained station above a merely stale one", () => {
    const radar = buildStationRadar([entry("skierg", 40), entry("sandbag_lunges", null)]);
    expect(radar?.headline).toBe("Sandbag Lunges is untouched — no session has covered it yet.");
  });

  it("says so when everything is recent", () => {
    const radar = buildStationRadar([entry("skierg", 1), entry("rowing", 3)]);
    expect(radar?.headline).toBe("Every station covered in the last 7 days.");
  });

  it("spells out running, which is not an exercise name", () => {
    const radar = buildStationRadar([entry("running", 0)]);
    expect(radar?.chips[0]).toMatchObject({ label: "Running", freshness: "Today" });
  });
});

describe("StationRadar", () => {
  it("carries each station's freshness in words, not colour alone", () => {
    const radar = buildStationRadar([entry("skierg", 2), entry("sled_pull", 21)]);
    render(<StationRadar radar={radar!} />);

    expect(screen.getByTestId("station-radar-headline")).toHaveTextContent("Sled Pull is coldest");
    expect(screen.getByTestId("station-radar-chip-skierg")).toHaveTextContent("SkiErg 2d ago");
    expect(screen.getByTestId("station-radar-chip-sled_pull")).toHaveTextContent(
      "Sled Pull 21d ago",
    );
  });
});
