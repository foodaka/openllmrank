import { createHmac, timingSafeEqual } from "node:crypto";

export const REPORT_LINK_TTL_SECONDS = 90 * 24 * 60 * 60;

function signatureFor(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

type ParsedToken = {
  jobId: string;
  expiresAt: number;
  signature: string;
};

function parseToken(token: string): ParsedToken | null {
  if (!token || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const parts = decoded.split(".");
  if (parts.length !== 3) return null;
  const [jobId, expiresAtRaw, signature] = parts;
  if (!jobId || !expiresAtRaw || !signature || !/^\d+$/.test(expiresAtRaw)) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null;
  return { jobId, expiresAt, signature };
}

function hasValidSignature(parsed: ParsedToken, secret: string): boolean {
  const expectedSignature = signatureFor(
    `${parsed.jobId}.${parsed.expiresAt}`,
    secret,
  );
  const actual = Buffer.from(parsed.signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Create the stateless token used in report emails. The expiry is included in
 * the signed payload, so the web app can verify it without a database token.
 */
export function createReportToken(
  jobId: string,
  secret: string,
  expiresAt = Math.floor(Date.now() / 1000) + REPORT_LINK_TTL_SECONDS,
): string {
  if (!jobId || !secret) throw new Error("jobId and secret are required");
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new Error("expiresAt must be a positive Unix timestamp");
  }

  const payload = `${jobId}.${expiresAt}`;
  const signature = signatureFor(payload, secret);
  return Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
}

/**
 * Verify a token against the report id in the URL. Malformed, tampered, and
 * expired tokens all fail closed without throwing into the route handler.
 */
export function verifyReportToken(
  token: string,
  jobId: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!jobId || !secret) return false;
  const parsed = parseToken(token);
  return Boolean(
    parsed &&
      parsed.jobId === jobId &&
      parsed.expiresAt > now &&
      hasValidSignature(parsed, secret),
  );
}

/** Return the expiry for a correctly signed token, even after it expires. */
export function getVerifiedReportTokenExpiry(
  token: string,
  jobId: string,
  secret: string,
): number | null {
  if (!jobId || !secret) return null;
  const parsed = parseToken(token);
  return parsed && parsed.jobId === jobId && hasValidSignature(parsed, secret)
    ? parsed.expiresAt
    : null;
}
