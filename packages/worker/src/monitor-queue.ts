// Monitor tick: pure bookkeeping around the existing crawl queue (eng review
// decision 1A — monitors NEVER run crawls themselves).
//
//   PHASE A  startDueMonitorCrawls
//     active monitor, no pending crawl, next_crawl_at due
//       ├─ adopt: an active (queued/running) crawl_checks row for the domain
//       └─ else insert one (source='monitor'); on unique-violation re-adopt
//     → pending_check_id set. The crawl loop does the actual crawling.
//
//   PHASE B  harvestFinishedMonitorCrawls
//     pending check reached a terminal state
//       ├─ classify email (packages/crawl: baseline/changes/all_clear/…)
//       ├─ mint report token, render, SEND
//       └─ on success: last_check_id / last_complete_check_id advance,
//          next_crawl_at = +7d, pending cleared, attempts reset
//          on failure: attempts+1 (retry next tick); after MAX_EMAIL_ATTEMPTS
//          advance anyway with last_email_error kept — a broken mailbox must
//          not stall the crawl schedule forever.
//
// Delivery is AT-LEAST-ONCE: state advances only after a successful send, so
// a crash between send and advance re-diffs the same deterministic inputs
// and may re-send. Rows are claimed FOR UPDATE SKIP LOCKED per phase.

import type { SQL } from "bun";
import {
  classifyMonitorEmail,
  FindingSchema,
  isTerminalState,
  type CrawlState,
  type Finding,
} from "@openllmrank/crawl";
import { z } from "zod";
import { env } from "./env";
import { renderMonitorEmail, sendMonitorEmail } from "./monitor-emailer";

const FindingsSchema = z.array(FindingSchema);
const BATCH = 5;
const MAX_EMAIL_ATTEMPTS = 5;

export type MonitorRow = {
  id: string;
  domain: string;
  origin: string;
  email: string;
  pending_check_id: string | null;
  last_complete_check_id: string | null;
  email_attempts: number;
};

/** Phase A. Returns how many monitors got a crawl attached (adopted or inserted). */
export async function startDueMonitorCrawls(sql: SQL): Promise<number> {
  const due = (await sql`
    select id, domain, origin, email, pending_check_id, last_complete_check_id, email_attempts
    from public.crawl_monitors
    where status = 'active' and pending_check_id is null and next_crawl_at <= now()
    order by next_crawl_at asc
    for update skip locked
    limit ${BATCH}
  `) as unknown as MonitorRow[];

  let started = 0;
  for (const monitor of due) {
    const checkId = await adoptOrInsertCheck(sql, monitor);
    if (checkId) {
      await sql`
        update public.crawl_monitors set pending_check_id = ${checkId} where id = ${monitor.id}
      `;
      started++;
    }
  }
  return started;
}

async function adoptOrInsertCheck(sql: SQL, monitor: MonitorRow): Promise<string | null> {
  const adopt = async (): Promise<string | null> => {
    const rows = (await sql`
      select id from public.crawl_checks
      where domain = ${monitor.domain} and state in ('queued', 'running')
      order by created_at desc limit 1
    `) as unknown as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  };

  const existing = await adopt();
  if (existing) return existing;

  try {
    const rows = (await sql`
      insert into public.crawl_checks (domain, origin, requester_ip_hash, source)
      values (${monitor.domain}, ${monitor.origin}, ${"monitor:" + monitor.id}, 'monitor')
      returning id
    `) as unknown as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  } catch (e) {
    // Unique active-crawl-per-domain violation: someone else just queued
    // this domain — adopt the winner.
    if ((e as { code?: string }).code === "23505" || /duplicate key/.test((e as Error).message)) {
      return await adopt();
    }
    throw e;
  }
}

type TerminalCheck = {
  id: string;
  state: CrawlState;
  pages_crawled: number;
  findings_jsonb: unknown;
};

/** Phase B. Returns how many monitors were emailed (or advanced past the cap). */
export async function harvestFinishedMonitorCrawls(sql: SQL): Promise<number> {
  const ready = (await sql`
    select m.id, m.domain, m.origin, m.email, m.pending_check_id,
           m.last_complete_check_id, m.email_attempts
    from public.crawl_monitors m
    join public.crawl_checks c on c.id = m.pending_check_id
    where m.status = 'active'
      and c.state in ('complete', 'partial', 'failed')
    order by m.next_crawl_at asc
    for update skip locked
    limit ${BATCH}
  `) as unknown as MonitorRow[];

  let processed = 0;
  for (const monitor of ready) {
    processed += (await processFinishedMonitor(sql, monitor)) ? 1 : 0;
  }
  return processed;
}

async function processFinishedMonitor(sql: SQL, monitor: MonitorRow): Promise<boolean> {
  const checks = (await sql`
    select id, state, pages_crawled, findings_jsonb
    from public.crawl_checks where id = ${monitor.pending_check_id}
  `) as unknown as TerminalCheck[];
  const current = checks[0];
  if (!current || !isTerminalState(current.state)) return false;

  const currentFindings = parseFindings(current.findings_jsonb);

  let previousCompleteFindings: Finding[] | null = null;
  if (monitor.last_complete_check_id) {
    const prev = (await sql`
      select findings_jsonb from public.crawl_checks where id = ${monitor.last_complete_check_id}
    `) as unknown as Array<{ findings_jsonb: unknown }>;
    if (prev[0]) previousCompleteFindings = parseFindings(prev[0].findings_jsonb);
  }

  const { kind, diff } = classifyMonitorEmail({
    previousCompleteFindings,
    currentState: current.state,
    currentFindings,
  });

  // Fresh report token for this email (existing token semantics).
  const tokenRows = (await sql`
    insert into public.crawl_report_tokens (check_id, requester_ip_hash)
    values (${current.id}, ${"monitor:" + monitor.id})
    returning token
  `) as unknown as Array<{ token: string }>;
  const reportUrl = `${env.reportBaseUrl}/check/${tokenRows[0]!.token}`;
  const portalUrl =
    env.monitorPortalUrl ||
    "mailto:report@openllmrank.io?subject=Cancel%20crawl%20monitoring";

  const rendered = renderMonitorEmail({
    kind,
    domain: monitor.domain,
    pagesCrawled: current.pages_crawled,
    currentFindings,
    diff,
    reportUrl,
    portalUrl,
  });

  const result = await sendMonitorEmail({
    monitorId: monitor.id,
    to: monitor.email,
    rendered,
  });

  if (result.ok) {
    await advance(sql, monitor, current, null);
    return true;
  }

  const attempts = monitor.email_attempts + 1;
  if (attempts >= MAX_EMAIL_ATTEMPTS) {
    // Give up on this cycle's email but keep the schedule moving.
    await advance(sql, monitor, current, `${result.code}: ${result.message}`);
    return true;
  }
  await sql`
    update public.crawl_monitors
    set email_attempts = ${attempts}, last_email_error = ${`${result.code}: ${result.message}`}
    where id = ${monitor.id}
  `;
  return false;
}

async function advance(
  sql: SQL,
  monitor: MonitorRow,
  current: TerminalCheck,
  emailError: string | null,
): Promise<void> {
  await sql`
    update public.crawl_monitors
    set last_check_id = ${current.id},
        last_complete_check_id = ${current.state === "complete" ? current.id : monitor.last_complete_check_id},
        pending_check_id = null,
        next_crawl_at = now() + interval '7 days',
        email_attempts = 0,
        last_email_error = ${emailError}
    where id = ${monitor.id}
  `;
}

function parseFindings(raw: unknown): Finding[] {
  if (raw === null || raw === undefined) return [];
  const parsed = FindingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}
