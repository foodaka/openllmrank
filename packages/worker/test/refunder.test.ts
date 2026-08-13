// Integration coverage for the refunder's refundable-job boundary.
// Skips cleanly when local Supabase is unavailable.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { fetchPendingRefunds } from "../src/refunder";

const PG_HOST = process.env.SUPABASE_TEST_HOST ?? "127.0.0.1";
const PG_PORT = process.env.SUPABASE_TEST_PORT ?? "54332";
const PG_URL = `postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/postgres`;

async function pgReachable(url: string): Promise<boolean> {
  try {
    const probe = new SQL(url);
    await probe`select 1`;
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await pgReachable(PG_URL);
const describePg = reachable ? describe : describe.skip;
const testPg = reachable ? test : test.skip;

let sql: SQL;
let userId = "";
let brandId = "";

const sampleConfig = {
  brand: { name: "RefundTestCo", aliases: [] },
  competitors: [],
  prompts: ["best tools for tests"],
  providers: [{ id: "openai", model: "gpt-4o-mini" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

beforeAll(async () => {
  if (reachable) sql = new SQL(PG_URL);
});

afterAll(async () => {
  if (reachable) await sql.end();
});

beforeEach(async () => {
  if (!reachable) return;

  await sql`delete from auth.users where email like 'refund-test%@example.com'`;
  const users = (await sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'refund-test@example.com', '$2a$10$fake', now())
    returning id
  `) as unknown as Array<{ id: string }>;
  userId = users[0]!.id;

  const brands = (await sql`
    insert into public.brands (user_id, name)
    values (${userId}, 'RefundTestCo')
    returning id
  `) as unknown as Array<{ id: string }>;
  brandId = brands[0]!.id;
});

describePg("fetchPendingRefunds", () => {
  testPg("returns refundable one-shot jobs and excludes subscription failures", async () => {
    const rows = (await sql`
      insert into public.jobs (
        user_id, brand_id, status, origin, refund_status, config_jsonb,
        amount_cents, email_to, stripe_payment_intent_id, failed_at
      )
      values
        (${userId}, ${brandId}, 'failed', 'one_shot', 'pending', ${JSON.stringify(sampleConfig)}::jsonb,
         2999, 'refund-test@example.com', 'pi_refund_test', now()),
        (${userId}, ${brandId}, 'failed', 'scheduled', 'pending', ${JSON.stringify(sampleConfig)}::jsonb,
         0, 'refund-test@example.com', null, now()),
        (${userId}, ${brandId}, 'failed', 'manual', 'pending', ${JSON.stringify(sampleConfig)}::jsonb,
         0, 'refund-test@example.com', 'pi_should_not_refund', now()),
        (${userId}, ${brandId}, 'failed', 'one_shot', 'pending', ${JSON.stringify(sampleConfig)}::jsonb,
         2999, 'refund-test@example.com', null, now())
      returning id
    `) as unknown as Array<{ id: string }>;

    const candidates = await fetchPendingRefunds(sql);
    expect(candidates.map((row) => row.id)).toEqual([rows[0]!.id]);
  });
});
