// Loop #4: free crawl checks (see index.ts header). Runs beside the paid
// loops in the same process — crawls are IO-bound (politeness delays), so
// they don't block the event loop. Isolation guards per eng review 8A:
// the loop body is fully try/caught, at most ONE crawl runs at a time, the
// engine caps pages/response sizes/total duration, and a crash releases or
// terminally fails the row instead of wedging it.

import { runCheck } from "@openllmrank/crawl";
import { db } from "./db";
import { env } from "./env";
import { alert } from "./alerts";
import {
  claimCrawlCheck,
  failCrawl,
  finishCrawl,
  writePhase1,
  writeProgress,
} from "./crawl-queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** stop() resolves when the loop has actually exited — a flag-only stop let
 * an in-flight iteration claim one more row after callers assumed the loop
 * was dead (review finding: flaky teardown in tests, late claims on shutdown). */
export type CrawlLoopHandle = { stop: () => Promise<void> };

export function startCrawlLoop(): CrawlLoopHandle {
  let stopped = false;
  // Idle backoff: the fast poll (1s) exists for the "first signal in seconds"
  // promise, but an always-empty queue doesn't need ~86k claim transactions a
  // day (review finding). Consecutive empty claims stretch the interval up to
  // the paid loop's cadence; any hit snaps it back to fast.
  let emptyClaims = 0;

  const loopDone = (async () => {
    while (!stopped) {
      try {
        const sql = db();
        const row = await claimCrawlCheck(sql);
        if (!row) {
          emptyClaims++;
          const backoff = Math.min(
            env.crawlPollIntervalMs * Math.min(emptyClaims, 5),
            env.pollIntervalMs,
          );
          await sleep(backoff);
          continue;
        }
        emptyClaims = 0;
        console.log(
          `[worker] claimed crawl=${row.id} domain=${row.domain} (attempt ${row.attempts})`,
        );

        try {
          // Throttle progress writes: every page fetch fires onProgress, but
          // one UPDATE per ~2s is plenty for a 3s-poll report page.
          let lastProgressWrite = 0;
          const result = await runCheck(row.origin, {
            onPhase1: (phase1) => writePhase1(sql, row.id, phase1),
            onProgress: async (p) => {
              const now = Date.now();
              if (now - lastProgressWrite < 2000) return;
              lastProgressWrite = now;
              await writeProgress(sql, row.id, p);
            },
          });
          await finishCrawl(sql, row.id, result);
          console.log(
            `[worker] crawl=${row.id} ${result.state}: ${result.pages_crawled} pages, ${result.findings.length} findings`,
          );
        } catch (e) {
          const msg = (e as Error).message;
          console.error(`[worker] crawl=${row.id} engine error: ${msg}`);
          await failCrawl(sql, row, msg);
          await alert("warn", "crawl check engine error", {
            crawl_id: row.id,
            domain: row.domain,
            error: msg,
          });
        }
      } catch (e) {
        // Claim/DB-level failure — never let this loop die (decision 8A).
        await alert("error", "crawl loop tick failed", {
          message: (e as Error).message,
        });
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
