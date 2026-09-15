import { SQL } from "bun";
import { env } from "../src/env";
import { backfillRunMetrics } from "../src/run-metrics";

const sql = new SQL(env.databaseUrl);

try {
  const count = await backfillRunMetrics(sql);
  console.log(`Backfilled run_metrics for ${count} completed run${count === 1 ? "" : "s"}.`);
} finally {
  await sql.end();
}
