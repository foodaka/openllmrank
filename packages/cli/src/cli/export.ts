import { defineCommand } from "citty";
import { getCallsSince, getCitationsSince, getPrompts, openDb } from "../core/db";

function parseSince(spec: string): string {
  const match = /^(\d+)([hd])$/.exec(spec);
  if (match) {
    const n = Number.parseInt(match[1]!, 10);
    const unit = match[2];
    const ms = unit === "h" ? n * 60 * 60 * 1000 : n * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
  }
  const d = new Date(spec);
  if (Number.isNaN(d.getTime())) {
    console.error(`! Invalid --since value '${spec}'.`);
    process.exit(1);
  }
  return d.toISOString();
}

export const exportCmd = defineCommand({
  meta: {
    name: "export",
    description: "Export calls + citations as NDJSON to stdout",
  },
  args: {
    db: { type: "string", default: "data/openllmrank.db" },
    since: { type: "string", default: "30d" },
  },
  async run({ args }) {
    const db = openDb(args.db);
    const since_iso = parseSince(args.since);
    const calls = getCallsSince(db, since_iso);
    const citations = getCitationsSince(db, since_iso);
    const prompt_ids = Array.from(new Set(calls.map((c) => c.prompt_id)));
    const prompts = getPrompts(db, prompt_ids);
    const promptById = new Map(prompts.map((p) => [p.prompt_id, p]));
    const citationsByCall = new Map<string, typeof citations>();
    for (const c of citations) {
      const k = `${c.run_id}|${c.prompt_id}|${c.sample_index}`;
      if (!citationsByCall.has(k)) citationsByCall.set(k, []);
      citationsByCall.get(k)!.push(c);
    }
    for (const c of calls) {
      const p = promptById.get(c.prompt_id);
      const k = `${c.run_id}|${c.prompt_id}|${c.sample_index}`;
      const out = {
        run_id: c.run_id,
        ts: c.ts,
        prompt_id: c.prompt_id,
        prompt_text: p?.prompt_text ?? null,
        provider: p?.provider ?? null,
        model: p?.model ?? null,
        sample_index: c.sample_index,
        response_text: c.response_text,
        citations: (citationsByCall.get(k) ?? []).map((x) => ({
          brand: x.brand,
          matched_text: x.matched_text,
          kind: x.kind,
        })),
        latency_ms: c.latency_ms,
        tokens_in: c.tokens_in,
        tokens_out: c.tokens_out,
        cost_usd: c.cost_usd,
        error_code: c.error_code,
      };
      console.log(JSON.stringify(out));
    }
  },
});
