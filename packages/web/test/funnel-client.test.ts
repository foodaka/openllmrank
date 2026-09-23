import { afterEach, expect, test } from "bun:test";
import { getAcquisition, trackFunnel } from "../lib/funnel-client";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
afterEach(() => {
  for (const [key, descriptor] of [["window", originalWindow], ["document", originalDocument], ["sessionStorage", originalStorage]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("first public landing survives navigation; tracking failure cannot break the funnel", () => {
  const values = new Map<string, string>();
  const win = { location: { pathname: "/check" }, va: () => { throw new Error("blocked analytics"); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { referrer: "https://www.google.com/search?q=private" } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) } });
  expect(getAcquisition()).toEqual({ landing: "/check", source: "google" });
  win.location.pathname = "/wizard/review";
  expect(getAcquisition()).toEqual({ landing: "/check", source: "google" });
  expect([...values.values()].join()).not.toContain("private");
  expect(() => trackFunnel("checkout_start", { plan: "tracking" })).not.toThrow();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("storage denied"); } });
  expect(getAcquisition()).toEqual({ landing: "/check", source: "google" });
});
