import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createClient } from "@supabase/supabase-js";
import { HOSTED_REPORT_PROVIDERS } from "@openllmrank/shared/config";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54331";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PG_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54332/postgres";

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new SQL(PG_URL);
    await probe`select 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const enabled = Boolean(ANON_KEY && SERVICE_KEY && (await pgReachable()));
const describePg = enabled ? describe : describe.skip;
const testPg = enabled ? test : test.skip;

if (!enabled) {
  console.warn(
    "[auth.integration.test] Skipping: local Supabase and auth keys are required.",
  );
}

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= SERVICE_KEY;
process.env.POSTMARK_MODE = "local_stub";
process.env.NEXT_PUBLIC_SITE_ORIGIN ??= "http://localhost:3000";

let postWebhook: ((request: Request) => Promise<Response>) | undefined;
if (enabled) {
  // Keep the Next route outside the root TypeScript project. The web package
  // has its own @/* path mapping; the root project intentionally does not.
  const route = await import(
    new URL("../app/api/webhook/stripe/route.ts", import.meta.url).href
  );
  postWebhook = route.POST;
}

const admin = enabled
  ? createClient(SUPABASE_URL, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

const TEST_EMAIL_PREFIX = "auth21-integration-";

describePg("auth foundation integration", () => {
  testPg("webhook invites a new customer who can set a password", async () => {
    const email = `${TEST_EMAIL_PREFIX}${crypto.randomUUID()}@example.com`;
    const sessionId = `cs_auth21_${crypto.randomUUID()}`;
    const eventId = `evt_auth21_${crypto.randomUUID()}`;
    let userId: string | null = null;
    let leadId: string | null = null;

    try {
      const config = {
        brand: {
          name: "Auth Integration Co",
          aliases: [],
          website: "https://auth-integration.example.com",
          category: "software",
        },
        competitors: [{ name: "Rival Co", aliases: [] }],
        prompts: ["best software for integration tests"],
        providers: [...HOSTED_REPORT_PROVIDERS],
        samples_per_prompt: 3,
        concurrency_per_provider: 1,
      };

      const { data: lead, error: leadError } = await admin!.from("leads").insert({
        email,
        brand_name: config.brand.name,
        competitor_count: config.competitors.length,
        prompt_count: config.prompts.length,
        config_jsonb: config,
        source: "auth-integration-test",
        status: "started",
      }).select("id").single();
      if (leadError || !lead) throw leadError ?? new Error("lead was not created");
      leadId = lead.id;

      const response = await postWebhook!(new Request("http://localhost/api/webhook/stripe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stub-event": "1",
        },
        body: JSON.stringify({
          id: eventId,
          type: "checkout.session.completed",
          data: {
            object: {
              id: sessionId,
              payment_intent: `pi_auth21_${crypto.randomUUID()}`,
              customer_email: email,
              metadata: { lead_id: leadId },
            },
          },
        }),
      }));
      expect(response.status).toBe(200);

      const body = await response.json() as { user_id: string; job_id: string };
      userId = body.user_id;
      expect(typeof body.job_id).toBe("string");

      const { data: user, error: userError } = await admin!.auth.admin.getUserById(userId);
      expect(userError).toBeNull();
      expect(user.user?.email).toBe(email);
      // The webhook's generateLink call is the invite send. Supabase records
      // that recovery link issuance on the provisioned user.
      expect(Boolean(user.user?.recovery_sent_at)).toBe(true);

      const recovery = createClient(SUPABASE_URL, ANON_KEY!, {
        auth: { persistSession: false, flowType: "implicit" },
      });
      const generated = await admin!.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: "http://localhost:3000/auth/set-password" },
      });
      expect(generated.error).toBeNull();
      const actionLink = generated.data.properties?.action_link;
      if (!actionLink) throw new Error("recovery link was not generated");
      const verified = await fetch(actionLink, {
        redirect: "manual",
      });
      expect(verified.status).toBe(303);
      const location = verified.headers.get("location") ?? "";
      expect(location).toContain("/auth/set-password#access_token=");
      const fragment = new URL(location).hash.slice(1);
      const params = new URLSearchParams(fragment);
      const session = await recovery.auth.setSession({
        access_token: params.get("access_token")!,
        refresh_token: params.get("refresh_token")!,
      });
      expect(session.error).toBeNull();

      const updated = await recovery.auth.updateUser({
        password: "auth21-integration-password",
      });
      expect(updated.error).toBeNull();
      const signedIn = await recovery.auth.signInWithPassword({
        email,
        password: "auth21-integration-password",
      });
      expect(signedIn.error).toBeNull();
      expect(signedIn.data.user?.id).toBe(userId);
    } finally {
      if (eventId) await admin?.from("stripe_events").delete().eq("id", eventId);
      if (leadId) await admin?.from("leads").delete().eq("id", leadId);
      if (userId) await admin?.auth.admin.deleteUser(userId);
    }
  });

  testPg("signout invalidates the previous access token", async () => {
    const email = `${TEST_EMAIL_PREFIX}${crypto.randomUUID()}@example.com`;
    let userId: string | null = null;

    try {
      const created = await admin!.auth.admin.createUser({
        email,
        password: "auth21-integration-password",
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw created.error ?? new Error("user was not created");
      }
      userId = created.data.user.id;

      const client = createClient(SUPABASE_URL, ANON_KEY!, {
        auth: { persistSession: false },
      });
      const signedIn = await client.auth.signInWithPassword({
        email,
        password: "auth21-integration-password",
      });
      if (signedIn.error || !signedIn.data.session) {
        throw signedIn.error ?? new Error("sign in failed");
      }
      const oldAccessToken = signedIn.data.session.access_token;

      const signedOut = await client.auth.signOut();
      expect(signedOut.error).toBeNull();

      const oldTokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: ANON_KEY!,
          authorization: `Bearer ${oldAccessToken}`,
        },
      });
      expect(oldTokenResponse.ok).toBe(false);
    } finally {
      if (userId) await admin?.auth.admin.deleteUser(userId);
    }
  });
});
