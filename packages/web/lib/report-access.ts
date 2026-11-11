import {
  reportLinkSecret,
  verifyReportToken,
} from "@openllmrank/shared/report-token";
import { userClient } from "./supabase-server";

// Access control for one report (E2, D6/D10). Shared by the report page and
// the ask-the-report endpoint, so both admit exactly the same readers.
// A report resolves through four paths, in order:
//
//   1. ?t=<token> valid and unexpired            -> allowed, no session needed
//   2. session present and job.user_id = user.id -> allowed
//   3. bare UUID and report_link_expires_at > now -> allowed (legacy grace)
//   4. otherwise                                  -> refused
//
// Tokens are stateless HMACs (packages/shared/src/report-token.ts). The
// legacy grace exists so report emails already sitting in inboxes keep
// working for 90 days after deploy; new emails carry a token.

export type ReportAccess =
  | { ok: true; via: "token" | "session" | "grace" }
  | { ok: false };

export const REPORT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function authorizeReportAccess(args: {
  token: string | null;
  jobId: string;
  jobUserId: string;
  expiresAt: string | null;
}): Promise<ReportAccess> {
  if (args.token) {
    const claims = verifyReportToken(args.token, reportLinkSecret());
    if (claims && claims.jobId === args.jobId) return { ok: true, via: "token" };
  }

  try {
    const supabase = await userClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && user.id === args.jobUserId) return { ok: true, via: "session" };
  } catch {
    // No cookie store (e.g. called outside a request scope): fall through.
  }

  if (args.expiresAt && new Date(args.expiresAt).getTime() > Date.now()) {
    return { ok: true, via: "grace" };
  }
  return { ok: false };
}
