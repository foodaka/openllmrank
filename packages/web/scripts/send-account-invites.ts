#!/usr/bin/env bun
/**
 * Send setup links to customers provisioned before the invite email existed.
 * Run once against the intended Supabase project with:
 *
 *   bun run --cwd packages/web auth:invite-existing
 */

import { createClient } from "@supabase/supabase-js";
import { sendAccountInviteEmail, normalizeAccountEmail } from "../lib/account-invite";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
  );
}

const supabase = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("email_to, user_id")
    .eq("origin", "one_shot")
    .neq("status", "pending");
  if (error) throw new Error(`Could not load one-shot customers: ${error.message}`);

  const candidates = new Map<string, string>();
  for (const job of jobs ?? []) {
    if (!candidates.has(job.user_id)) {
      candidates.set(job.user_id, normalizeAccountEmail(job.email_to));
    }
  }

  const emails: string[] = [];
  for (const [userId, fallbackEmail] of candidates) {
    const { data, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !data.user?.email) {
      console.warn(`Skipping customer ${fallbackEmail}: auth user not found.`);
      continue;
    }
    emails.push(normalizeAccountEmail(data.user.email));
  }

  console.log(`Sending account setup links to ${emails.length} customer(s).`);
  for (const email of emails) {
    const result = await sendAccountInviteEmail({ supabase, to: email });
    const state = result.sent ? "sent" : result.actionLink ? "generated" : "failed";
    console.log(`  ${state} ${email}`);
  }
}

await main();
