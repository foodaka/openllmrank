import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as realSupabaseServer from "../lib/supabase-server";

type QueryResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
};

const state: {
  user: { id: string; email: string } | null;
  subscription: unknown;
  brand: unknown;
  activeBrands: { id: string }[];
  inserted: Record<string, unknown> | null;
  updated: Record<string, unknown> | null;
} = {
  user: { id: "user-1", email: "user@example.com" },
  subscription: { id: "subscription-1" },
  brand: {
    id: "brand-1",
    cadence: "weekly",
    next_run_at: "2026-09-10T00:00:00.000Z",
    archived_at: null,
  },
  activeBrands: [{ id: "brand-1" }],
  inserted: null,
  updated: null,
};

function query(
  result: QueryResult | ((selection: string | null) => QueryResult),
): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  let selection: string | null = null;
  chain.select = (columns: string) => {
    selection = columns;
    return chain;
  };
  for (const method of ["eq", "in", "limit", "order", "is"]) {
    chain[method] = (..._args: unknown[]) => chain;
  }
  chain.insert = (payload: Record<string, unknown>) => {
    state.inserted = payload;
    return chain;
  };
  chain.update = (payload: Record<string, unknown>) => {
    state.updated = payload;
    return chain;
  };
  const getResult = () =>
    typeof result === "function" ? result(selection) : result;
  chain.single = () => Promise.resolve(getResult());
  chain.maybeSingle = () => Promise.resolve(getResult());
  chain.then = (
    onFulfilled: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(getResult()).then(onFulfilled, reject);
  return chain;
}

const supabase = {
  auth: {
    getUser: async () => ({
      data: { user: state.user },
      error: state.user ? null : { message: "No session" },
    }),
  },
  from(table: string) {
    if (table === "subscriptions") {
      return query({ data: state.subscription, error: null });
    }
    if (table === "brands") {
      return query((selection) => {
        if (selection === "id") {
          return { data: state.activeBrands, error: null };
        }
        if (selection === "id,name") {
          return { data: { id: "brand-new", name: "Acme" }, error: null };
        }
        return { data: state.brand, error: null };
      });
    }
    throw new Error(`Unexpected table: ${table}`);
  },
};

mock.module("@/lib/supabase-server", () => ({
  ...realSupabaseServer,
  userClient: async () => supabase,
}));

const { POST: createBrand } = await import(
  new URL("../app/api/brands/route.ts", import.meta.url).href,
);
const { PATCH: updateBrand } = await import(
  new URL("../app/api/brands/[brandId]/route.ts", import.meta.url).href,
);

const validConfig = {
  brand: {
    name: "Acme",
    aliases: ["Acme Corp"],
    website: "https://acme.example",
    category: "B2B analytics platforms",
  },
  competitors: [{ name: "Beta", aliases: [] }],
  prompts: ["best analytics tools"],
  providers: [{ id: "openai" as const, model: "browser-controlled" }],
  samples_per_prompt: 3,
  concurrency_per_provider: 4,
};

beforeEach(() => {
  state.user = { id: "user-1", email: "user@example.com" };
  state.subscription = { id: "subscription-1" };
  state.brand = {
    id: "brand-1",
    cadence: "weekly",
    next_run_at: "2026-09-10T00:00:00.000Z",
    archived_at: null,
  };
  state.activeBrands = [{ id: "brand-1" }];
  state.inserted = null;
  state.updated = null;
});

describe("brand management routes", () => {
  test("requires an active subscription before creating a brand", async () => {
    state.subscription = null;

    const response = await createBrand(
      new Request("http://localhost/api/brands", {
        method: "POST",
        body: JSON.stringify({ config: validConfig }),
      }),
    );

    expect(response.status).toBe(403);
    expect(state.inserted).toBeNull();
  });

  test("rejects configurations above hosted caps on the server", async () => {
    const response = await createBrand(
      new Request("http://localhost/api/brands", {
        method: "POST",
        body: JSON.stringify({
          config: {
            ...validConfig,
            prompts: Array.from({ length: 11 }, (_, index) => `prompt ${index}`),
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  test("creates a weekly brand with the server-owned provider lineup", async () => {
    const response = await createBrand(
      new Request("http://localhost/api/brands", {
        method: "POST",
        body: JSON.stringify({ config: validConfig }),
      }),
    );

    expect(response.status).toBe(201);
    expect(state.inserted?.user_id).toBe("user-1");
    expect(state.inserted?.name).toBe("Acme");
    expect(state.inserted?.cadence).toBe("weekly");
    expect(state.inserted?.next_run_at).toEqual(expect.any(String));
    const savedConfig = state.inserted?.config_jsonb as typeof validConfig;
    expect(savedConfig.providers).toHaveLength(5);
    expect(savedConfig.prompts).toEqual(validConfig.prompts);
  });

  test("creates a monthly brand when the weekly limit would be exceeded", async () => {
    state.activeBrands = [{ id: "brand-1" }, { id: "brand-2" }];

    const response = await createBrand(
      new Request("http://localhost/api/brands", {
        method: "POST",
        body: JSON.stringify({ config: validConfig }),
      }),
    );

    expect(response.status).toBe(201);
    expect(state.inserted?.cadence).toBe("monthly");
  });

  test("updates config and cadence without touching the scheduled history", async () => {
    const response = await updateBrand(
      new Request("http://localhost/api/brands/brand-1", {
        method: "PATCH",
        body: JSON.stringify({ config: validConfig, cadence: "monthly" }),
      }),
      { params: { brandId: "brand-1" } },
    );

    expect(response.status).toBe(200);
    expect(state.updated?.config_jsonb).toBeDefined();
    expect(state.updated?.cadence).toBe("monthly");
    expect(state.updated?.next_run_at).toBe("2026-09-10T00:00:00.000Z");
  });

  test("rejects configurations above hosted caps on edit", async () => {
    const response = await updateBrand(
      new Request("http://localhost/api/brands/brand-1", {
        method: "PATCH",
        body: JSON.stringify({
          config: {
            ...validConfig,
            prompts: Array.from({ length: 11 }, (_, index) => `prompt ${index}`),
          },
        }),
      }),
      { params: { brandId: "brand-1" } },
    );

    expect(response.status).toBe(400);
    expect(state.updated).toBeNull();
  });

  test("normalizes a weekly edit to monthly above the weekly limit", async () => {
    state.activeBrands = [
      { id: "brand-1" },
      { id: "brand-2" },
      { id: "brand-3" },
    ];

    const response = await updateBrand(
      new Request("http://localhost/api/brands/brand-1", {
        method: "PATCH",
        body: JSON.stringify({ config: validConfig, cadence: "weekly" }),
      }),
      { params: { brandId: "brand-1" } },
    );

    expect(response.status).toBe(200);
    expect(state.updated?.cadence).toBe("monthly");
  });

  test("archives a brand by pausing it and clearing its next run", async () => {
    const response = await updateBrand(
      new Request("http://localhost/api/brands/brand-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "archive" }),
      }),
      { params: Promise.resolve({ brandId: "brand-1" }) },
    );

    expect(response.status).toBe(200);
    expect(state.updated?.archived_at).toEqual(expect.any(String));
    expect(state.updated?.cadence).toBe("paused");
    expect(state.updated?.next_run_at).toBeNull();
  });
});
