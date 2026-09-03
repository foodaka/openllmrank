import { describe, expect, it } from "bun:test";
import {
  createBillingPortalSession,
  createSubscriptionSession,
} from "../lib/stripe";

process.env.STRIPE_MODE = "local_stub";

describe("local billing sessions", () => {
  it("creates a subscription stub that can replay Checkout metadata", async () => {
    const session = await createSubscriptionSession({
      amountCents: 2900,
      currency: "usd",
      productName: "openllmrank tracking",
      userId: "user-billing-test",
      email: "billing@example.com",
      successUrl: "http://localhost:3000/checkout/success",
      cancelUrl: "http://localhost:3000/dashboard/billing",
    });

    const url = new URL(session.url);
    expect(session.mode).toBe("local_stub");
    expect(url.searchParams.get("stub")).toBe("1");
    expect(url.searchParams.get("subscription")).toBe("1");
    expect(url.searchParams.get("user_id")).toBe("user-billing-test");
    expect(url.searchParams.get("subscription_id")).toStartWith("sub_stub_");
    expect(url.searchParams.get("customer_id")).toBe("cus_stub_user-billing-test");
  });

  it("returns to billing from the local billing portal stub", async () => {
    const session = await createBillingPortalSession({
      customerId: "cus_billing_test",
      returnUrl: "http://localhost:3000/dashboard/billing",
    });

    expect(session.mode).toBe("local_stub");
    expect(session.url).toBe(
      "http://localhost:3000/dashboard/billing?portal=stub",
    );
  });
});
