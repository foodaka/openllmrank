import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
// Relative imports: this route is imported by packages/web/test, which is
// type-checked from the root tsconfig without the "@/" alias.
import { defaultAgentDeps } from "../../../lib/agent-tools";
import { buildServer } from "../../../lib/mcp-server";
import { getClientIp } from "../../../lib/rate-limit";

// POST /api/mcp — the MCP endpoint AI agents connect to (Muse Connector
// Platform "Existing MCP", Claude, ChatGPT, any MCP client). Tools live in
// lib/mcp-server.ts; what they do lives in lib/agent-tools.ts.
//
// Stateless streamable HTTP with JSON responses, so a request is one
// serverless invocation and nothing is held open: long-running analyses are
// polled (get_report_status), never awaited.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// analyze_brand_visibility may read the website and draft questions first.
export const maxDuration = 90;

export async function POST(req: Request): Promise<Response> {
  const siteOrigin = (
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? new URL(req.url).origin
  ).replace(/\/+$/, "");
  const server = buildServer(defaultAgentDeps(siteOrigin), getClientIp(req));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

// Stateless server: there is no event stream to open and no session to end.
function methodNotAllowed(): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
