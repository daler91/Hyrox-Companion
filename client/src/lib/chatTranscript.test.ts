import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/chatMessage";

import { buildTranscript, chatDayLabel } from "./chatTranscript";

const NOW = new Date(2026, 9, 1, 18, 0); // 1 Oct 2026, 18:00 local

function message(id: string, sentAt: Date | undefined, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: "user",
    content: id,
    timestamp: "",
    createdAtMs: 0,
    ...(sentAt ? { sentAtMs: sentAt.getTime() } : {}),
    ...overrides,
  };
}

describe("chatDayLabel", () => {
  it("names today and yesterday, and dates anything older", () => {
    expect(chatDayLabel(new Date(2026, 9, 1, 0, 5).getTime(), NOW)).toBe("Today");
    expect(chatDayLabel(new Date(2026, 8, 30, 23, 55).getTime(), NOW)).toBe("Yesterday");
    const older = chatDayLabel(new Date(2026, 8, 29, 12, 0).getTime(), NOW);
    expect(older).not.toMatch(/Today|Yesterday|2026/);
    expect(older).toMatch(/29/);
  });

  it("adds the year to a date from another year", () => {
    expect(chatDayLabel(new Date(2025, 11, 31, 12, 0).getTime(), NOW)).toMatch(/2025/);
  });
});

describe("buildTranscript", () => {
  it("puts a separator ahead of each day's first message, and none ahead of the welcome", () => {
    const items = buildTranscript(
      [
        message("welcome", undefined, { role: "assistant" }),
        message("a", new Date(2026, 8, 30, 9, 0)),
        message("b", new Date(2026, 8, 30, 9, 5)),
        message("c", new Date(2026, 9, 1, 8, 0)),
      ],
      NOW,
    );

    expect(items.map((item) => (item.type === "day" ? `day:${item.label}` : item.message.id))).toEqual([
      "welcome",
      "day:Yesterday",
      "a",
      "b",
      "day:Today",
      "c",
    ]);
  });

  it("sets the note a new session carried apart from the messages", () => {
    const items = buildTranscript(
      [message("note", new Date(2026, 9, 1, 7, 59), { kind: "summary", role: "assistant" }), message("q", new Date(2026, 9, 1, 8, 0))],
      NOW,
    );

    expect(items.map((item) => item.type)).toEqual(["day", "summary", "message"]);
  });
});
