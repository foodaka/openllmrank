import { verifyReportToken } from "@openllmrank/shared/report-token";

export type ReportAccessJob = {
  user_id: string;
  report_link_expires_at: string | null;
};

export type ReportAccessResult =
  | { allowed: true; method: "signed" | "session" | "legacy" | "rollback" }
  | { allowed: false; status: 401 | 404 };

export function reportLinkEnforcementEnabled(
  value = process.env.REPORT_LINK_ENFORCE,
): boolean {
  return value !== "false";
}

/**
 * Resolve report access after the route has loaded the job by id.
 *
 * A malformed or expired token never falls through to legacy access. This is
 * important because changing one character in a signed URL must not turn it
 * into a valid old-style UUID URL during the grace period.
 */
export async function resolveReportAccess(args: {
  jobId: string;
  job: ReportAccessJob | null;
  token: string | null;
  hasToken: boolean;
  secret: string | undefined;
  getUserId: () => Promise<string | null>;
  now?: Date;
}): Promise<ReportAccessResult> {
  if (!args.job) return { allowed: false, status: 404 };
  const now = args.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (
    args.token &&
    args.secret &&
    verifyReportToken(args.token, args.jobId, args.secret, nowSeconds)
  ) {
    return { allowed: true, method: "signed" };
  }

  const userId = await args.getUserId();
  if (userId) {
    return args.job.user_id === userId
      ? { allowed: true, method: "session" }
      : { allowed: false, status: 404 };
  }

  const expiresAt = args.job.report_link_expires_at
    ? Date.parse(args.job.report_link_expires_at)
    : Number.NaN;
  if (!args.hasToken && Number.isFinite(expiresAt) && expiresAt > now.getTime()) {
    return { allowed: true, method: "legacy" };
  }

  return { allowed: false, status: 401 };
}
