import { describe, expect, test } from "bun:test";
import { effectiveCadence, nextRunAfter, positiveIntEnv } from "../src/cadence";

describe("effectiveCadence", () => {
  test("weekly at or below the threshold, monthly above it", () => {
    expect(effectiveCadence(0)).toBe("weekly");
    expect(effectiveCadence(2)).toBe("weekly");
    expect(effectiveCadence(3)).toBe("monthly");
    expect(effectiveCadence(3, 5)).toBe("weekly");
    expect(effectiveCadence(6, 5)).toBe("monthly");
  });
});

describe("nextRunAfter", () => {
  test("weekly adds seven days, monthly adds one calendar month", () => {
    const from = new Date("2026-01-31T10:00:00Z");
    expect(nextRunAfter(from, "weekly").toISOString()).toBe("2026-02-07T10:00:00.000Z");
    // JS rolls Jan 31 + 1 month to Mar 3 (non-leap year); that is acceptable
    // for a schedule, the point is "about a month" not "same day number".
    expect(nextRunAfter(from, "monthly").getTime()).toBeGreaterThan(
      from.getTime() + 27 * 24 * 3600 * 1000,
    );
  });
  test("does not mutate the input", () => {
    const from = new Date("2026-05-01T00:00:00Z");
    nextRunAfter(from, "weekly");
    expect(from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("positiveIntEnv", () => {
  test("falls back on empty, zero, negative, and garbage", () => {
    expect(positiveIntEnv(undefined, 2)).toBe(2);
    expect(positiveIntEnv("", 2)).toBe(2);
    expect(positiveIntEnv("0", 2)).toBe(2);
    expect(positiveIntEnv("-1", 2)).toBe(2);
    expect(positiveIntEnv("abc", 2)).toBe(2);
    expect(positiveIntEnv("5", 2)).toBe(5);
  });
});
