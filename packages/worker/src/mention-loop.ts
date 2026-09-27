// Loop #6: free "Does AI mention you?" checks. One check at a time; its
// assistants are asked in parallel. Isolation guards match the crawl loop:
// the body is fully try/caught, each provider call has a hard timeout, and
// an unexpected error releases the row for one retry instead of wedging it.

import type { SQL } from "bun";
import { getProviderDescriptor } from "openllmrank/src/providers/registry";
import type { Provider, ProviderId } from "openllmrank/src/core/types";
import {
  MENTION_SCHEMA_VERSION,
  normalizeQuestion,
  type MentionAnswerResult,
  type MentionResults,
} from "@openllmrank/shared/mention-check";
import { db } from "./db";
import { env } from "./env";
import { alert } from "./alerts";
import {
  claimMentionCheck,
  failMentionCheck,
  findCachedAnswer,
  finishMentionCheck,
  saveAnswer,
  type MentionCheckRow,
} from "./mention-queue";
import { failedAnswer, questionHash, scoreAnswer } from "./mention-score";

const PROVIDER_TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type MentionDeps = {
  /** Provider factory; tests inject stubs. Throws when a key is missing. */
  provider: (id: ProviderId) => Provider;
};

export const defaultMentionDeps: MentionDeps = {
  provider(id) {
    const descriptor = getProviderDescriptor(id);
    if (!descriptor?.create) throw new Error(`provider ${id} is not implemented`);
    return descriptor.create({ apiKey: process.env[descriptor.envVar] });
  },
};

/** Ask every configured assistant (cache first), score, and persist. */
export async function runMentionCheck(
  sql: SQL,
  row: MentionCheckRow,
  deps: MentionDeps = defaultMentionDeps,
): Promise<"complete" | "failed"> {
  const question = normalizeQuestion(row.question);
  const hash = questionHash(question);
  const brand = { name: row.brand_name, domain: row.domain };
  let costUsd = 0;

  const answers: MentionAnswerResult[] = await Promise.all(
    row.providers_jsonb.map(async ({ id, model }) => {
      try {
        const cached = await findCachedAnswer(sql, id, model, hash);
        if (cached) {
          return scoreAnswer({ provider: id, model, ...cached, cached: true }, brand);
        }
        const result = await deps.provider(id).query({
          prompt: question,
          model,
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
        costUsd += result.cost_usd;
        await saveAnswer(sql, {
          provider: id,
          model,
          hash,
          question,
          response_text: result.response_text,
          search_results: result.search_results,
          cost_usd: result.cost_usd,
        });
        return scoreAnswer(
          {
            provider: id,
            model,
            response_text: result.response_text,
            search_results: result.search_results,
            cached: false,
          },
          brand,
        );
      } catch (e) {
        // One assistant failing must not sink the others' answers.
        const err = e as { message?: string; kind?: string };
        console.error(`[worker] mention=${row.id} provider=${id} failed: ${err.kind ?? ""} ${err.message ?? e}`);
        return failedAnswer(id, model);
      }
    }),
  );

  const answered = answers.filter((a) => a.status === "ok");
  if (answered.length === 0) {
    await failMentionCheck(sql, row, "None of the AI assistants answered. Try again in a few minutes.", costUsd, {
      retry: false,
    });
    await alert("warn", "mention check: every provider failed", { mention_id: row.id });
    return "failed";
  }

  const results: MentionResults = {
    schema_version: MENTION_SCHEMA_VERSION,
    answers,
    mentioned_count: answered.filter((a) => a.mentioned).length,
    answered_count: answered.length,
  };
  await finishMentionCheck(sql, row.id, results, costUsd);
  return "complete";
}

export type MentionLoopHandle = { stop: () => Promise<void> };

export function startMentionLoop(deps: MentionDeps = defaultMentionDeps): MentionLoopHandle {
  let stopped = false;
  // Same idle backoff as the crawl loop: fast when busy, the paid loop's
  // cadence when the queue stays empty.
  let emptyClaims = 0;

  const loopDone = (async () => {
    while (!stopped) {
      try {
        const sql = db();
        const row = await claimMentionCheck(sql);
        if (!row) {
          emptyClaims++;
          await sleep(Math.min(env.crawlPollIntervalMs * Math.min(emptyClaims, 5), env.pollIntervalMs));
          continue;
        }
        emptyClaims = 0;
        console.log(`[worker] claimed mention=${row.id} domain=${row.domain} (attempt ${row.attempts})`);
        try {
          const outcome = await runMentionCheck(sql, row, deps);
          console.log(`[worker] mention=${row.id} ${outcome}`);
        } catch (e) {
          const msg = (e as Error).message;
          console.error(`[worker] mention=${row.id} error: ${msg}`);
          await failMentionCheck(sql, row, "Something went wrong on our side. Try again.", 0, { retry: true });
          await alert("warn", "mention check error", { mention_id: row.id, error: msg });
        }
      } catch (e) {
        // Claim/DB-level failure — never let this loop die.
        await alert("error", "mention loop tick failed", { message: (e as Error).message });
        await sleep(env.crawlPollIntervalMs);
      }
    }
  })();

  return {
    stop() {
      stopped = true;
      return loopDone;
    },
  };
}
