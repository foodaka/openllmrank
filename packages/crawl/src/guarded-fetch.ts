// SSRF-guarded fetch — the ONLY module in the codebase allowed to make an
// outbound request to a user-supplied host. Web and worker both import this;
// there is deliberately no second implementation anywhere.
//
//   guardedFetch(url)
//        │ 1. parse: http(s) only, default ports only (80/443)
//        │ 2. DNS resolve ALL addresses
//        │ 3. validate EVERY address against private/reserved/metadata ranges
//        │ 4. connect via node:http(s) with a PINNED lookup that returns only
//        │    the validated address — the socket can never follow a DNS rebind
//        │ 5. redirect? → re-run 1-4 on the Location target (max hops)
//        │ 6. stream body up to maxBytes, hard timeout, then discard
//        ▼
//   { status, finalUrl, body?, headers }
//
// DNS rebinding note: because the connection is made to the address validated
// in step 3 (not re-resolved at connect time), the classic validate-then-
// reconnect TOCTOU window is closed.

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export type GuardedFetchOptions = {
  /** Max redirect hops to follow (each hop is re-validated). */
  maxRedirects?: number;
  /** Max response body bytes to read; the rest is discarded and the socket destroyed. */
  maxBytes?: number;
  /** Per-request timeout in ms (connect + headers + body). */
  timeoutMs?: number;
  /** User-Agent header. */
  userAgent?: string;
  /** TEST ONLY: permit private/loopback targets so fixtures on 127.0.0.1 work.
   * Disables BOTH the address blocklist and the default-port rule. */
  allowPrivate?: boolean;
  /** TEST ONLY: allowlist of specific addresses exempt from blocking (port
   * rule also relaxed). Unlike allowPrivate, every OTHER address stays
   * validated — this is what lets tests prove a redirect hop to a blocked
   * address is refused while the fixture itself is reachable. */
  allowOnly?: string[];
  /** TEST ONLY: pin hostnames to fixed addresses without real DNS. */
  resolveOverride?: (hostname: string) => string | null;
};

export type GuardedFetchResult = {
  status: number;
  /** URL after redirects; equals the request URL when none were followed. */
  finalUrl: string;
  headers: Record<string, string>;
  /** Body text, up to maxBytes. */
  body: string;
  /** True when the body was cut off at maxBytes. */
  truncated: boolean;
};

export class GuardedFetchError extends Error {
  constructor(
    public readonly code:
      | "invalid_url"
      | "blocked_address"
      | "dns_failure"
      | "too_many_redirects"
      | "timeout"
      | "network_error",
    message: string,
  ) {
    super(message);
    this.name = "GuardedFetchError";
  }
}

const DEFAULTS = {
  maxRedirects: 5,
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 10_000,
  userAgent: "openllmrank-crawlcheck/1.0 (+https://openllmrank.io/check)",
};

// ── Address validation ──────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (
    ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
  );
}

function inV4Cidr(ip: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

// Private, reserved, loopback, link-local (cloud metadata lives in
// 169.254.0.0/16), benchmarking, documentation, multicast, and broadcast.
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, prefix]) => inV4Cidr(n, base, prefix));
}

/** Expand an IPv6 literal into its 8 hextets, folding a trailing dotted-quad
 * into the last two groups. Returns null when the literal is malformed.
 * String-prefix matching is NOT safe here: WHATWG URL normalizes dotted
 * v4-mapped forms into hex ("[::ffff:127.0.0.1]" → "[::ffff:7f00:1]"), so
 * every check below works on the numeric hextets. */
function expandV6(ip: string): number[] | null {
  let head = ip.toLowerCase();
  // Fold an embedded dotted quad ("::ffff:1.2.3.4") into two hextets.
  const dotted = head.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = dotted[2]!.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    head = `${dotted[1]}${(((parts[0]! << 8) | parts[1]!) >>> 0).toString(16)}:${(((parts[2]! << 8) | parts[3]!) >>> 0).toString(16)}`;
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right = halves.length === 2 ? (halves[1] === "" ? [] : halves[1]!.split(":")) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const hextets: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    hextets.push(Number.parseInt(g, 16));
  }
  return hextets;
}

function isBlockedV6(ip: string): boolean {
  const h = expandV6(ip);
  if (h === null) return true; // unparseable — refuse

  const embeddedV4 = ((h[6]! << 16) | h[7]!) >>> 0;
  const v4FromEmbedded = () =>
    BLOCKED_V4.some(([base, prefix]) => inV4Cidr(embeddedV4, base, prefix));

  // v4-mapped ::ffff:0:0/96 and deprecated v4-compatible ::/96 — the
  // embedded 32 bits carry the real target; delegate to the v4 rules.
  const firstFiveZero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
  if (firstFiveZero && h[5] === 0xffff) return v4FromEmbedded();
  if (firstFiveZero && h[5] === 0) {
    // ::/96 covers :: (unspecified) and ::1 (loopback) too — both blocked.
    if (embeddedV4 <= 1) return true;
    return v4FromEmbedded();
  }
  // NAT64 64:ff9b::/96.
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
    return v4FromEmbedded();
  }
  // Unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8,
  // documentation 2001:db8::/32 — all by numeric prefix, not string prefix.
  if ((h[0]! & 0xfe00) === 0xfc00) return true;
  if ((h[0]! & 0xffc0) === 0xfe80) return true;
  if ((h[0]! & 0xff00) === 0xff00) return true;
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;
  return false;
}

/** True when the address must never be connected to. Exported for tests. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // not an IP at all — refuse
}

// ── URL validation + resolution ─────────────────────────────────────────────

function parseTarget(rawUrl: string, opts: GuardedFetchOptions): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new GuardedFetchError("invalid_url", `Not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GuardedFetchError(
      "invalid_url",
      `Only http/https allowed, got ${url.protocol}`,
    );
  }
  // Default ports only — a crawler has no business on :8080 etc., and open
  // ports are exactly what SSRF probes hunt for. (allowPrivate/allowOnly are
  // the test escape hatches: fixture servers can't bind :80.)
  if (url.port !== "" && !opts.allowPrivate && !opts.allowOnly) {
    const allowed = url.protocol === "https:" ? "443" : "80";
    if (url.port !== allowed) {
      throw new GuardedFetchError(
        "invalid_url",
        `Non-default port ${url.port} is not allowed`,
      );
    }
  }
  if (url.username || url.password) {
    throw new GuardedFetchError("invalid_url", "Credentials in URL not allowed");
  }
  return url;
}

async function resolveAndValidate(
  hostname: string,
  opts: GuardedFetchOptions,
): Promise<string> {
  // URL.hostname wraps IPv6 literals in brackets ("[::1]") — strip them so
  // the literal-IP path below actually sees them.
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  const exempt = (ip: string): boolean =>
    opts.allowPrivate === true || (opts.allowOnly?.includes(ip) ?? false);

  // Literal IPs skip DNS but not validation.
  if (isIP(bare)) {
    if (!exempt(bare) && isBlockedAddress(bare)) {
      throw new GuardedFetchError(
        "blocked_address",
        `Address ${bare} is in a blocked range`,
      );
    }
    return bare;
  }

  if (opts.resolveOverride) {
    const pinned = opts.resolveOverride(hostname);
    if (pinned) {
      // The override replaces DNS, not policy — its answer is validated like
      // any resolved address (lets tests prove blocked hops are refused).
      if (!exempt(pinned) && isBlockedAddress(pinned)) {
        throw new GuardedFetchError(
          "blocked_address",
          `${hostname} resolves to blocked address ${pinned}`,
        );
      }
      return pinned;
    }
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new GuardedFetchError("dns_failure", `DNS lookup failed for ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new GuardedFetchError("dns_failure", `No addresses for ${hostname}`);
  }
  // EVERY address must be clean — a hostile zone can mix a clean address with
  // an internal one and hope for the wrong pick.
  for (const { address } of addresses) {
    if (!exempt(address) && isBlockedAddress(address)) {
      throw new GuardedFetchError(
        "blocked_address",
        `${hostname} resolves to blocked address ${address}`,
      );
    }
  }
  return addresses[0]!.address;
}

// ── Pinned request ──────────────────────────────────────────────────────────

function requestOnce(
  url: URL,
  pinnedAddress: string,
  opts: Required<Pick<GuardedFetchOptions, "maxBytes" | "timeoutMs" | "userAgent">>,
): Promise<{ status: number; headers: Record<string, string>; body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    // Single-settlement bookkeeping: Bun's event ordering differs from Node's
    // (req 'close' can precede the response 'end' handler), so every outcome
    // goes through settle()/settleErr() and the first one wins.
    let settled = false;
    const settle = (value: {
      status: number;
      headers: Record<string, string>;
      body: string;
      truncated: boolean;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallClock);
      resolve(value);
    };
    const settleErr = (err: GuardedFetchError) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallClock);
      reject(err);
    };
    // Wall-clock bound. Node's request `timeout` option only fires on socket
    // INACTIVITY — a hostile server dripping one byte every few seconds keeps
    // that timer reset forever and wedges the (single-crawl) worker loop.
    // This timer bounds TOTAL request duration.
    const wallClock = setTimeout(() => {
      req.destroy(
        new GuardedFetchError("timeout", `Timed out fetching ${url.href}`),
      );
    }, opts.timeoutMs);
    if (typeof wallClock.unref === "function") wallClock.unref();
    // The pinned lookup hands the socket the address we validated — never a
    // fresh DNS answer. Supports both callback signatures node uses.
    const pinnedLookup = ((
      _hostname: string,
      options: unknown,
      cb?: (err: Error | null, address: unknown, family?: number) => void,
    ) => {
      const done = (typeof options === "function" ? options : cb) as (
        err: Error | null,
        address: unknown,
        family?: number,
      ) => void;
      const family = isIP(pinnedAddress);
      const wantsAll =
        typeof options === "object" && options !== null && (options as { all?: boolean }).all;
      if (wantsAll) done(null, [{ address: pinnedAddress, family }]);
      else done(null, pinnedAddress, family);
    }) as unknown as import("node:net").LookupFunction;

    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        lookup: pinnedLookup,
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml,text/plain,*/*;q=0.5",
          "Accept-Encoding": "identity", // no decompression bombs
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (received - opts.maxBytes)));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(", ");
          }
          settle({
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          });
        };
        res.on("end", finish);
        // destroy() after truncation fires "close" without "end". For any
        // OTHER early close, the body is incomplete — resolving it as a
        // normal response would let a flaky/hostile server plant false
        // findings from partial HTML (Codex finding). res.complete is true
        // only when the message ended cleanly.
        res.on("close", () => {
          if (truncated || res.complete) finish();
          else {
            settleErr(
              new GuardedFetchError(
                "network_error",
                `Incomplete response from ${url.href} (connection closed mid-body)`,
              ),
            );
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new GuardedFetchError("timeout", `Timed out fetching ${url.href}`));
    });
    // Last-resort settlement: destroy() does not reliably emit 'error' in
    // every runtime (observed in Bun when no response ever arrived), which
    // left this promise pending forever. 'close' always fires — but in Bun it
    // can fire BEFORE the response handlers on success, so give any pending
    // finish/error a short grace period before declaring the connection dead.
    req.on("close", () => {
      setTimeout(
        () =>
          settleErr(
            new GuardedFetchError("timeout", `Connection closed fetching ${url.href}`),
          ),
        50,
      );
    });
    req.on("error", (err) => {
      settleErr(
        err instanceof GuardedFetchError
          ? err
          : new GuardedFetchError("network_error", `${url.href}: ${(err as Error).message}`),
      );
    });
    req.end();
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function guardedFetch(
  rawUrl: string,
  options: GuardedFetchOptions = {},
): Promise<GuardedFetchResult> {
  const opts = { ...DEFAULTS, ...options };
  let url = parseTarget(rawUrl, options);

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const pinned = await resolveAndValidate(url.hostname, options);
    const res = await requestOnce(url, pinned, opts);

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      // Every hop is parsed and re-validated exactly like the first URL.
      url = parseTarget(new URL(res.headers.location, url).href, options);
      continue;
    }
    return {
      status: res.status,
      finalUrl: url.href,
      headers: res.headers,
      body: res.body,
      truncated: res.truncated,
    };
  }
  throw new GuardedFetchError(
    "too_many_redirects",
    `More than ${opts.maxRedirects} redirects from ${rawUrl}`,
  );
}
