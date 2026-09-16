import { describe, expect, test } from "bun:test";
import { guardedFetch, GuardedFetchError } from "@openllmrank/crawl";
import { normalizeWebsite, suggestFromWebsite, SuggestionError, WebsiteSuggestionsSchema } from "../lib/website-suggestions";
import { handleWizardSuggest } from "../lib/wizard-suggest-handler";

const draft = { name: "Acme", category: "privacy-first analytics", prompts: ["What analytics tools work without cookies?", "Which analytics tools are best for small teams?", "How can I measure conversions without collecting personal data?"], competitors: ["Plausible", "Fathom"] };
const page = { status: 200, finalUrl: "https://acme.com/", body: "<html><title>Acme</title><main>" + "Privacy-first analytics for growing businesses. Track conversions without cookies. ".repeat(10) + "</main></html>", headers: { "content-type": "text/html" }, truncated: false };
const request = (body: unknown = { website: "acme.com" }, headers = {}) => new Request("https://openllmrank.io/api/wizard/suggest", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const deps = () => ({ userId: async () => crypto.randomUUID(), configured: () => true, suggest: async () => draft });
const fetchPage: typeof guardedFetch = async url => url.endsWith('/robots.txt') ? { ...page, status: 404, body: '' } : page;

describe("website suggestions", () => {
  test("generated categories obey the checkout schema", () => {
    for (const category of ["x", "x".repeat(121)]) {
      expect(WebsiteSuggestionsSchema.safeParse({ ...draft, category }).success).toBe(false);
    }
    expect(WebsiteSuggestionsSchema.safeParse({ ...draft, category: "x".repeat(120) }).success).toBe(true);
  });
  test("normalizes domains and rejects unsafe URL forms", () => {
    expect(normalizeWebsite(" acme.com/product#x ")).toBe("https://acme.com/product");
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "https://user:pass@acme.com", "http://acme.com:8080", "", null]) expect(() => normalizeWebsite(value)).toThrow();
  });
  test("unauthenticated requests cannot fetch or spend", async () => {
    let called = false;
    const res = await handleWizardSuggest(request(), { ...deps(), userId: async () => null, suggest: async () => { called = true; return draft; } });
    expect(res.status).toBe(401); expect(called).toBe(false);
  });
  test("rejects cross-origin and oversized requests", async () => {
    expect((await handleWizardSuggest(request({}, { origin: "https://evil.com" }), deps())).status).toBe(403);
    expect((await handleWizardSuggest(request({ website: 'a'.repeat(5000) }), deps())).status).toBe(413);
  });
  test("returns honest unavailable state without configured credentials", async () => {
    let called = false;
    expect((await handleWizardSuggest(request(), { ...deps(), configured: () => false, suggest: async () => { called = true; return draft; } })).status).toBe(503);
    expect(called).toBe(false);
  });
  test("rate limit gates generation per authenticated user", async () => {
    const id = crypto.randomUUID(); let calls = 0;
    const d = { ...deps(), userId: async () => id, suggest: async () => { calls++; return draft; } };
    for (let i = 0; i < 5; i++) expect((await handleWizardSuggest(request(), d)).status).toBe(200);
    const res = await handleWizardSuggest(request(), d);
    expect(res.status).toBe(429); expect(res.headers.get('Retry-After')).toBeTruthy(); expect(calls).toBe(5);
  });
  test("returns validated suggestions and passes bounded page data to model", async () => {
    let content = '';
    expect(await suggestFromWebsite('https://acme.com/', { fetchPage, complete: async text => { content = text; return draft; } })).toEqual(draft);
    expect(JSON.parse(content).title).toBe('Acme'); expect(content.length).toBeLessThan(9000);
  });
  test("competitor suggestions are cleaned without failing the draft", async () => {
    const competitors = [" Plausible ", "plausible", "", "Acme", "x".repeat(121), "Fathom", "Matomo", "Simple Analytics", "Umami", "Pirsch"];
    const result = await suggestFromWebsite('https://acme.com/', { fetchPage, complete: async () => ({ ...draft, competitors }) });
    expect(result.competitors).toEqual(["Plausible", "Fathom", "Matomo", "Simple Analytics", "Umami"]);
    const { competitors: _omit, ...withoutCompetitors } = draft;
    expect((await suggestFromWebsite('https://acme.com/', { fetchPage, complete: async () => withoutCompetitors })).competitors).toEqual([]);
  });
  test("robots refusal prevents page fetch and model call", async () => {
    let calls = 0;
    await expect(suggestFromWebsite('https://acme.com/', { fetchPage: async () => { calls++; return { ...page, body: 'User-agent: *\nDisallow: /' }; }, complete: async () => { throw new Error('must not call'); } })).rejects.toThrow('doesn’t allow');
    expect(calls).toBe(1);
  });
  test("redirect targets must pass their own robots rules before being read", async () => {
    const fetched: string[] = [];
    await expect(suggestFromWebsite('https://acme.com/', {
      fetchPage: async (url, options) => {
        fetched.push(url);
        if (url === 'https://acme.com/robots.txt') return { ...page, status: 404, body: '' };
        if (url === 'https://acme.com/') {
          expect(options?.followRedirects).toBe(false);
          return { ...page, status: 302, headers: { location: 'https://other.com/private' } };
        }
        if (url === 'https://other.com/robots.txt') return { ...page, body: 'User-agent: *\nDisallow: /private' };
        throw new Error('Must not fetch disallowed page');
      },
      complete: async () => { throw new Error('Must not generate'); },
    })).rejects.toThrow('doesn’t allow');
    expect(fetched).not.toContain('https://other.com/private');
  });
  test("private addresses are rejected through the shared fetch guard", async () => {
    await expect(suggestFromWebsite('http://127.0.0.1/', { fetchPage: guardedFetch, complete: async () => { throw new Error('must not call'); } })).rejects.toMatchObject({ status: 400 });
  });
  test("redirect policy errors cannot reach the model", async () => {
    await expect(suggestFromWebsite('https://acme.com/', { fetchPage: async () => { throw new GuardedFetchError('blocked_address', 'private redirect'); }, complete: async () => draft })).rejects.toMatchObject({ status: 400 });
  });
  test("unreadable pages and invalid model output fail instead of inventing drafts", async () => {
    await expect(suggestFromWebsite('https://acme.com/', { fetchPage: async url => url.endsWith('robots.txt') ? { ...page, status: 404 } : { ...page, body: '<p>Log in</p>' }, complete: async () => draft })).rejects.toThrow('enough readable text');
    for (const output of [{}, { ...draft, name: '' }, { ...draft, prompts: [draft.prompts[0], draft.prompts[0], draft.prompts[0]] }]) {
      await expect(suggestFromWebsite('https://acme.com/', { fetchPage, complete: async () => output })).rejects.toBeInstanceOf(SuggestionError);
    }
  });
  test("provider failures do not expose credentials or internal errors", async () => {
    const res = await handleWizardSuggest(request(), { ...deps(), suggest: async () => { throw new Error('secret-key'); } });
    expect(res.status).toBe(503); expect(await res.text()).not.toContain('secret-key');
  });
});
