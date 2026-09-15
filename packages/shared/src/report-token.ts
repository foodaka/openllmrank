// Signed report links (E2, D6/D10).
//
// A report URL in an email must work without a session, but a forwarded
// email must not be a permanent leak. The link therefore carries a token:
//
//   base64url( job_id "." exp_unix "." hex(hmac_sha256(secret, job_id "." exp_unix)) )
//
// Nothing is stored: verification is a recomputation. Rotating the secret
// invalidates every outstanding link, which is the intended kill switch.

import { createHmac, timingSafeEqual } from "node:crypto";

export const REPORT_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

const DEV_SECRET = "dev-only-report-link-secret-not-for-production";
let warned = false;

/** The signing secret. Required in production; a fixed dev value otherwise. */
export function reportLinkSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.REPORT_LINK_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "REPORT_LINK_SECRET is required in production (openssl rand -hex 32).",
    );
  }
  if (!warned) {
    warned = true;
    console.warn("[report-token] REPORT_LINK_SECRET unset; using the dev-only secret.");
  }
  return DEV_SECRET;
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signReportToken(
  jobId: string,
  secret: string,
  ttlSeconds: number = REPORT_TOKEN_TTL_SECONDS,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = `${jobId}.${exp}`;
  return Buffer.from(`${payload}.${mac(payload, secret)}`, "utf8").toString("base64url");
}

export type VerifiedReportToken = { jobId: string; exp: number };

/** Returns the token's claims, or null for anything malformed, tampered, or expired. */
export function verifyReportToken(
  token: string | null | undefined,
  secret: string,
  nowMs: number = Date.now(),
): VerifiedReportToken | null {
  if (!token || token.length > 512) return null;
  let raw: string;
  try {
    raw = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [jobId, expRaw, given] = parts as [string, string, string];
  if (!jobId || !/^\d+$/.test(expRaw) || !/^[0-9a-f]{64}$/.test(given)) return null;
  const expected = mac(`${jobId}.${expRaw}`, secret);
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return null;
  return { jobId, exp };
}

/** Full URL for a report, with its signed token attached. */
export function signedReportUrl(baseUrl: string, jobId: string, secret: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/reports/${jobId}?t=${signReportToken(jobId, secret)}`;
}
