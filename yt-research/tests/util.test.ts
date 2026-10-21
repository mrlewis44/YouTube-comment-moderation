import { describe, expect, it } from "vitest";
import {
  formatDuration,
  median,
  normalizeVideoId,
  parseChannelRef,
  parseIsoDuration,
  toRfc3339,
} from "@/lib/util";

describe("parseIsoDuration", () => {
  it("parses common YouTube durations", () => {
    expect(parseIsoDuration("PT12M30S")).toBe(750);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT59S")).toBe(59);
    expect(parseIsoDuration("P1DT1H")).toBe(90000);
    expect(parseIsoDuration("P0D")).toBe(0);
  });
  it("returns null for missing or invalid input", () => {
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration("12:30")).toBeNull();
  });
  it("formats", () => {
    expect(formatDuration(750)).toBe("12:30");
    expect(formatDuration(3723)).toBe("1:02:03");
  });
});

describe("median", () => {
  it("handles odd, even, unsorted and empty lists", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([10, 2, 4, 8])).toBe(6);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });
  it("does not mutate its input", () => {
    const v = [3, 1, 2];
    median(v);
    expect(v).toEqual([3, 1, 2]);
  });
});

describe("normalizeVideoId", () => {
  it("accepts ids and URLs", () => {
    expect(normalizeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(normalizeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30")).toBe("dQw4w9WgXcQ");
    expect(normalizeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
    expect(normalizeVideoId("youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(normalizeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("rejects junk", () => {
    expect(() => normalizeVideoId("not a video")).toThrow();
  });
});

describe("parseChannelRef", () => {
  it("accepts ids, handles and URLs", () => {
    expect(parseChannelRef("UCownerownerownerowner01")).toEqual({ kind: "id", value: "UCownerownerownerowner01" });
    expect(parseChannelRef("@joshlewisCMC")).toEqual({ kind: "handle", value: "@joshlewisCMC" });
    expect(parseChannelRef("joshlewisCMC")).toEqual({ kind: "handle", value: "@joshlewisCMC" });
    expect(parseChannelRef("https://www.youtube.com/@joshlewisCMC/videos")).toEqual({ kind: "handle", value: "@joshlewisCMC" });
    expect(parseChannelRef("https://www.youtube.com/channel/UCownerownerownerowner01")).toEqual({
      kind: "id",
      value: "UCownerownerownerowner01",
    });
  });
});

describe("toRfc3339", () => {
  it("accepts dates and timestamps", () => {
    expect(toRfc3339("2026-01-15")).toBe("2026-01-15T00:00:00Z");
    expect(toRfc3339("2026-01-15T10:00:00-08:00")).toBe("2026-01-15T18:00:00Z");
    expect(() => toRfc3339("yesterday")).toThrow();
  });
});
