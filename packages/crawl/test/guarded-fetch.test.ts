import { describe, expect, test, afterAll } from "bun:test";
import {
  guardedFetch,
  GuardedFetchError,
  isBlockedAddress,
} from "../src/guarded-fetch";

describe("isBlockedAddress", () => {
  const blocked = [
    "0.0.0.1",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1", // CGNAT
    "127.0.0.1",
    "127.8.8.8",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.5", // documentation
    "192.168.1.1",
    "198.18.0.1", // benchmarking
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1", // unique local
    "fd12:3456::1",
    "fe80::1", // link-local
    "ff02::1", // multicast
    "2001:db8::1", // documentation
    "::ffff:10.0.0.1", // v4-mapped private
    "::ffff:169.254.169.254",
    "64:ff9b::10.0.0.1", // NAT64 private
    // HEX representations of v4-mapped/compat addresses — WHATWG URL
    // normalizes dotted forms into these, so the hex forms are what the
    // validator actually sees via a URL (security review finding).
    "::ffff:7f00:1", // 127.0.0.1 mapped, hex
    "::ffff:a9fe:a9fe", // 169.254.169.254 (cloud metadata) mapped, hex
    "::ffff:a00:1", // 10.0.0.1 mapped, hex
    "::127.0.0.1", // deprecated v4-compatible form
    "::7f00:1", // v4-compatible, hex
    "64:ff9b::a9fe:a9fe", // NAT64 metadata, hex
    "not-an-ip",
  ];
  for (const ip of blocked) {
    test(`blocks ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true));
  }

  const allowed = [
    "1.1.1.1",
    "8.8.8.8",
    "172.15.255.255", // just outside 172.16/12
    "172.32.0.1", // just outside 172.16/12
    "100.63.255.255", // just outside CGNAT
    "100.128.0.0", // just outside CGNAT
    "9.255.255.255", // just outside 10/8
    "11.0.0.0",
    "2606:4700:4700::1111", // public v6
    "::ffff:8.8.8.8", // v4-mapped public
  ];
  for (const ip of allowed) {
    test(`allows ${ip}`, () => expect(isBlockedAddress(ip)).toBe(false));
  }
});

describe("guardedFetch URL validation", () => {
  test("rejects non-http protocols", async () => {
    for (const url of ["ftp://example.com/", "file:///etc/passwd", "gopher://x/"]) {
      await expect(guardedFetch(url)).rejects.toThrow(GuardedFetchError);
    }
  });

  test("rejects non-default ports", async () => {
    await expect(guardedFetch("http://example.com:8080/")).rejects.toThrow(
      /Non-default port/,
    );
    await expect(guardedFetch("https://example.com:8443/")).rejects.toThrow(
      /Non-default port/,
    );
  });

  test("rejects credentials in URL", async () => {
    await expect(guardedFetch("https://user:pass@example.com/")).rejects.toThrow(
      /Credentials/,
    );
  });

  test("rejects literal blocked IPs without DNS", async () => {
    await expect(guardedFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /blocked range/,
    );
    await expect(guardedFetch("http://127.0.0.1/")).rejects.toThrow(/blocked range/);
    await expect(guardedFetch("http://[::1]/")).rejects.toThrow(/blocked range/);
  });

  test("rejects private literals wherever they appear", async () => {
    await expect(guardedFetch("http://10.0.0.8/")).rejects.toThrow(/blocked range/);
  });
});

describe("guardedFetch against a live fixture", () => {
  const server = Bun.serve({
    port: 0,
    fetch(req): Response | Promise<Response> {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/ok":
          return new Response("hello", { headers: { "content-type": "text/plain" } });
        case "/big":
          return new Response("x".repeat(100_000), {
            headers: { "content-type": "text/plain" },
          });
        case "/redirect":
          return new Response(null, { status: 302, headers: { location: "/ok" } });
        case "/redirect-ftp":
          return new Response(null, {
            status: 302,
            headers: { location: "ftp://example.com/" },
          });
        case "/redirect-nxdomain":
          return new Response(null, {
            status: 302,
            headers: { location: "http://crawlcheck-blocked-hop.invalid/" },
          });
        case "/redirect-metadata":
          return new Response(null, {
            status: 302,
            headers: { location: "http://crawlcheck-internal.invalid/latest/meta-data/" },
          });
        case "/stall":
          return new Promise<Response>(() => {});
        case "/redirect-loop":
          return new Response(null, { status: 302, headers: { location: "/redirect-loop" } });
        default:
          return new Response("nope", { status: 404 });
      }
    },
  });
  afterAll(() => server.stop(true));

  const base = `http://127.0.0.1:${server.port}`;
  const testOpts = { allowPrivate: true };

  test("fetches a body with status and finalUrl", async () => {
    const res = await guardedFetch(`${base}/ok`, testOpts);
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello");
    expect(res.finalUrl).toBe(`${base}/ok`);
    expect(res.truncated).toBe(false);
  });

  test("pinned lookup override actually drives the connection", async () => {
    // fake hostname that only works because resolveOverride pins it to the
    // fixture — if the pinned lookup were ignored, DNS would fail loudly.
    const res = await guardedFetch(`http://crawlcheck-fixture.invalid:${server.port}/ok`, {
      allowPrivate: true,
      resolveOverride: (host) => (host === "crawlcheck-fixture.invalid" ? "127.0.0.1" : null),
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello");
  });

  test("follows redirects and reports the final URL", async () => {
    const res = await guardedFetch(`${base}/redirect`, testOpts);
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe(`${base}/ok`);
  });

  test("redirect hops re-run protocol validation (ftp target dies)", async () => {
    await expect(guardedFetch(`${base}/redirect-ftp`, testOpts)).rejects.toThrow(
      /Only http\/https/,
    );
  });

  test("redirect hops re-run DNS resolution (unresolvable hop dies)", async () => {
    // .invalid is guaranteed NXDOMAIN — this proves each hop re-resolves and
    // re-validates instead of reusing the first hop's pinned address.
    await expect(guardedFetch(`${base}/redirect-nxdomain`, testOpts)).rejects.toThrow(
      /DNS lookup failed/,
    );
  });

  test("redirect loops end with too_many_redirects", async () => {
    await expect(guardedFetch(`${base}/redirect-loop`, testOpts)).rejects.toThrow(
      /redirects/,
    );
  });

  test("redirect hop to a BLOCKED address is refused (address checks live)", async () => {
    // allowOnly (not allowPrivate) keeps the blocklist active: the fixture's
    // 127.0.0.1 is allowlisted, the metadata hop is not — it must die.
    await expect(
      guardedFetch(`http://crawlcheck-fixture.invalid:${server.port}/redirect-metadata`, {
        allowOnly: ["127.0.0.1"],
        resolveOverride: (host) =>
          host === "crawlcheck-fixture.invalid"
            ? "127.0.0.1"
            : host === "crawlcheck-internal.invalid"
              ? "169.254.169.254"
              : null,
      }),
    ).rejects.toThrow(/blocked/);
  });

  test("a stalling server hits the wall-clock timeout", async () => {
    // Which message surfaces depends on runtime event ordering (destroy-error
    // vs close), but both paths reject with code "timeout" — the property
    // under test is that the request is BOUNDED, not which teardown won.
    const started = Date.now();
    await expect(
      guardedFetch(`${base}/stall`, { ...testOpts, timeoutMs: 300 }),
    ).rejects.toThrow(/Timed out|Connection closed/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("bodies are truncated at maxBytes", async () => {
    const res = await guardedFetch(`${base}/big`, { ...testOpts, maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(1000);
  });
});
