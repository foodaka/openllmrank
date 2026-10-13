import { handleSnapshot } from "../../../lib/snapshot-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handleSnapshot(req);
}
