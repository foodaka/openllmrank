import { SQL } from "bun";
import { env } from "./env";

// Single shared Postgres connection for the worker. We use service-role
// (the DATABASE_URL points at the postgres user / service key) so this
// bypasses RLS — appropriate because the worker has already verified the
// row it's acting on by checking jobs.user_id against expected ownership.

let _sql: SQL | null = null;

export function db(): SQL {
  if (_sql) return _sql;
  _sql = new SQL(env.databaseUrl);
  return _sql;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}
