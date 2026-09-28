// Teardowns: public data posts built from one local CLI run.
//
// scripts/teardown-data.ts reads a CLI openllmrank.db and calls buildTeardown()
// to write content/teardowns/<slug>.json. The blog post, its OG image and the
// hero chart all render from that one file, so a number is never retyped by
// hand. Edit the JSON's `quotes` down to the two or three you want to publish;
// everything else is computed and should be regenerated, not edited.

export type TeardownEngine = { provider: string; model: string };

export type TeardownBrandCount = { name: string; answers: number };

export type TeardownQuote = {
  provider: string;
  model: string;
  question: string;
  text: string;
  brands: string[];
};

export type TeardownData = {
  slug: string;
  run: {
    id: string;
    date: string; // YYYY-MM-DD, the day the run started
    questions: string[]; // the questions counted in every figure below
    // Questions that were run but left out of the counts, because they name
    // brands themselves ("A vs B vs C") and would inflate those brands. They
    // still appear in the full report.
    excluded_questions: string[];
    engines: TeardownEngine[];
    samples: number;
    answers: number; // successful calls counted (excluded questions left out)
    cost_usd: number; // API spend for the whole run, excluded questions included
  };
  highlight: string | null; // brand drawn in the emphasis colour
  // Share of answers whose TEXT names each brand (name or URL alias match).
  // A brand that only appears in a cited source's URL does not count: the
  // public claim is "the answer recommended it", not "a source mentioned it".
  brands: TeardownBrandCount[];
  by_engine: (TeardownEngine & { answers: number; brands: TeardownBrandCount[] })[];
  domains: { domain: string; citations: number; answers: number }[]; // answers = how many answers cited it at least once
  quotes: TeardownQuote[];
};

export type TeardownInput = {
  slug: string;
  highlight?: string;
  excludeQuestions?: string[]; // exact prompt texts to leave out of the counts
  brands: string[]; // tracked brand + competitors, as named in the config
  run: { run_id: string; started_at: string };
  calls: {
    run_id: string;
    prompt_id: string;
    sample_index: number;
    response_text: string;
    search_results_json: string;
    cost_usd: number;
    error_code: string | null;
  }[];
  citations: { run_id: string; prompt_id: string; sample_index: number; brand: string; kind: string }[];
  prompts: { prompt_id: string; prompt_text: string; provider: string; model: string }[];
};

// Gemini's grounding returns Google redirect URLs rather than the source page.
// Counting them would make "vertexaisearch.cloud.google.com" the top cited
// site in every teardown.
const REDIRECT_HOSTS = new Set(["vertexaisearch.cloud.google.com"]);

export const ENGINE_LABELS: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  perplexity: "Perplexity",
  xai: "Grok",
};

export function engineLabel(provider: string): string {
  return ENGINE_LABELS[provider] ?? provider;
}

export function domainOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return REDIRECT_HOSTS.has(host) ? null : host;
  } catch {
    return null;
  }
}

function sampleKey(c: { run_id: string; prompt_id: string; sample_index: number }): string {
  return `${c.run_id}|${c.prompt_id}|${c.sample_index}`;
}

function sortCounts(counts: Map<string, number>, names: string[]): TeardownBrandCount[] {
  return names
    .map((name) => ({ name, answers: counts.get(name) ?? 0 }))
    .sort((a, b) => b.answers - a.answers);
}

// Sentences short enough to quote that name at least one tracked brand.
function quoteCandidates(text: string, brands: string[]): { text: string; brands: string[] }[] {
  const out: { text: string; brands: string[] }[] = [];
  const clean = text
    .replace(/\[(\d+|[^\]]{0,40})\]\([^)]*\)/g, "") // markdown citation links
    .replace(/\[\d+\]/g, "")
    .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, "") // ([domain](url)) source chips
    .replace(/[*_#`>|]/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ");
  for (const raw of clean.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 60 || s.length > 240) continue;
    const named = brands.filter((b) => s.toLowerCase().includes(b.toLowerCase()));
    if (named.length > 0) out.push({ text: s, brands: named });
  }
  return out;
}

export function buildTeardown(input: TeardownInput, maxQuotes = 20): TeardownData {
  const excluded = new Set(input.excludeQuestions ?? []);
  const unknown = [...excluded].filter((q) => !input.prompts.some((p) => p.prompt_text === q));
  if (unknown.length > 0) throw new Error(`Excluded questions not in this run: ${unknown.join("; ")}`);
  const counted = input.prompts.filter((p) => !excluded.has(p.prompt_text));
  const promptById = new Map(counted.map((p) => [p.prompt_id, p]));
  const runCalls = input.calls.filter((c) => c.run_id === input.run.run_id && c.error_code === null);
  const ok = runCalls.filter((c) => promptById.has(c.prompt_id));
  const okKeys = new Set(ok.map(sampleKey));

  // brand -> set of answers whose text names it
  const named = new Map<string, Set<string>>();
  for (const cit of input.citations) {
    if (cit.kind === "grounded_source") continue;
    if (!input.brands.includes(cit.brand)) continue;
    const key = sampleKey(cit);
    if (!okKeys.has(key)) continue;
    if (!named.has(cit.brand)) named.set(cit.brand, new Set());
    named.get(cit.brand)!.add(key);
  }

  const total = new Map<string, number>();
  for (const [brand, keys] of named) total.set(brand, keys.size);

  const engines: TeardownEngine[] = [];
  for (const p of counted) {
    if (!engines.some((e) => e.provider === p.provider)) engines.push({ provider: p.provider, model: p.model });
  }

  const by_engine = engines.map((e) => {
    const answers = ok.filter((c) => promptById.get(c.prompt_id)!.provider === e.provider);
    const keys = new Set(answers.map(sampleKey));
    const counts = new Map<string, number>();
    for (const [brand, set] of named) {
      counts.set(brand, [...set].filter((k) => keys.has(k)).length);
    }
    return { ...e, answers: answers.length, brands: sortCounts(counts, input.brands) };
  });

  const domainCounts = new Map<string, number>();
  const domainAnswers = new Map<string, number>();
  for (const c of ok) {
    let results: { url?: string }[] = [];
    try {
      results = JSON.parse(c.search_results_json);
    } catch {
      continue;
    }
    const inThisAnswer = new Set<string>();
    for (const r of results) {
      const d = r.url ? domainOf(r.url) : null;
      if (!d) continue;
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
      inThisAnswer.add(d);
    }
    for (const d of inThisAnswer) domainAnswers.set(d, (domainAnswers.get(d) ?? 0) + 1);
  }
  const domains = [...domainCounts]
    .map(([domain, citations]) => ({ domain, citations, answers: domainAnswers.get(domain) ?? 0 }))
    .sort((a, b) => b.citations - a.citations || a.domain.localeCompare(b.domain))
    .slice(0, 10);

  // Spread candidates across engines (round-robin) so the first answers in the
  // run don't crowd out the rest; one per answer, at most `maxQuotes`.
  const perEngine = engines.map((e) => {
    const out: TeardownQuote[] = [];
    for (const c of ok) {
      const p = promptById.get(c.prompt_id)!;
      if (p.provider !== e.provider) continue;
      const first = quoteCandidates(c.response_text, input.brands)[0];
      if (first) out.push({ provider: p.provider, model: p.model, question: p.prompt_text, ...first });
    }
    return out;
  });
  const quotes: TeardownQuote[] = [];
  const seenQuote = new Set<string>();
  for (let i = 0; quotes.length < maxQuotes && perEngine.some((list) => i < list.length); i++) {
    for (const list of perEngine) {
      const q = list.at(i);
      if (!q || seenQuote.has(q.text) || quotes.length >= maxQuotes) continue;
      seenQuote.add(q.text);
      quotes.push(q);
    }
  }

  const questions = [...new Set(counted.map((p) => p.prompt_text))];
  const perQuestionEngine = new Map<string, number>();
  for (const c of ok) perQuestionEngine.set(c.prompt_id, (perQuestionEngine.get(c.prompt_id) ?? 0) + 1);
  const samples = Math.max(0, ...perQuestionEngine.values());

  return {
    slug: input.slug,
    run: {
      id: input.run.run_id,
      date: input.run.started_at.slice(0, 10),
      questions,
      excluded_questions: [...excluded],
      engines,
      samples,
      answers: ok.length,
      cost_usd: Math.round(input.calls.filter((c) => c.run_id === input.run.run_id).reduce((s, c) => s + c.cost_usd, 0) * 100) / 100,
    },
    highlight: input.highlight ?? null,
    brands: sortCounts(total, input.brands),
    by_engine,
    domains,
    quotes,
  };
}

export function sharePct(answers: number, total: number): number {
  return total === 0 ? 0 : Math.round((answers / total) * 100);
}
