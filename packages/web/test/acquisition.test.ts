import { describe, expect, test } from "bun:test";
import { acquisitionMetadata, referralSource, sanitizeAcquisition } from "../lib/acquisition";
import { paymentProperties } from "../lib/payment-analytics";

describe("acquisition privacy and payment integrity", () => {
  test("retains only public paths and known referral categories", () => {
    expect(sanitizeAcquisition({ landing: "/check/private-token?email=user@example.com", source: "user@example.com" })).toEqual({ landing: "other", source: "other" });
    expect(acquisitionMetadata({ landing: "/check", source: "google", email: "secret" })).toEqual({ acquisition_landing: "/check", acquisition_source: "google" });
  });
  test("classifies AI referrals without accepting lookalike hosts", () => {
    expect(referralSource("https://gemini.google.com/app/private")).toBe("gemini");
    expect(referralSource("https://www.google.co.uk/search?q=private")).toBe("google");
    expect(referralSource("https://chatgpt.com/?private=yes")).toBe("chatgpt");
    expect(referralSource("https://chatgpt.com.evil.example")).toBe("other");
    expect(referralSource("invalid")).toBe("other");
    expect(referralSource("")).toBe("direct");
  });
  test("classifies the social channels teardowns are posted on", () => {
    expect(referralSource("https://t.co/abc123")).toBe("x");
    expect(referralSource("https://x.com/someone/status/1")).toBe("x");
    expect(referralSource("https://www.linkedin.com/feed/")).toBe("linkedin");
    expect(referralSource("https://lnkd.in/xyz")).toBe("linkedin");
    expect(referralSource("https://news.ycombinator.com/item?id=1")).toBe("hackernews");
    expect(referralSource("https://t.co.evil.example")).toBe("other");
    expect(sanitizeAcquisition({ landing: "/blog/transactional-email-apis", source: "hackernews" })).toEqual({ landing: "/blog/transactional-email-apis", source: "hackernews" });
  });
  const event = (extra = {}) => ({ type: "checkout.session.completed", livemode: true, data: { object: { payment_status: "paid", mode: "subscription", amount_total: 4900, currency: "usd", metadata: { lead_id: "private-id", acquisition_landing: "/check", acquisition_source: "google" } } }, ...extra });
  test("records live verified paid checkout properties without identifiers", () => {
    expect(paymentProperties(event())).toEqual({ landing: "/check", source: "google", plan: "tracking", amount_cents: 4900, currency: "usd" });
  });
  test("excludes test, stub, unpaid, and unrelated webhook events", () => {
    expect(paymentProperties(event({ livemode: false }))).toBeNull();
    expect(paymentProperties(event({ type: "invoice.paid" }))).toBeNull();
    expect(paymentProperties(event({ data: { object: { payment_status: "unpaid" } } }))).toBeNull();
    expect(paymentProperties(null)).toBeNull();
  });
});
