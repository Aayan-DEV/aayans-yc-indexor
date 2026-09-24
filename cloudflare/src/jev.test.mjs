import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { judgeWithJev } from "./jev.ts";

const originalFetch = globalThis.fetch;
const candidates = [{ info: "Acme makes accounting software", colors: "blue" }];
const response = (score) => ({ answers: { c0: { noul: score } }, usage: { input_tokens: 12 } });

afterEach(() => { globalThis.fetch = originalFetch; });

test("uses the gateway answer without calling the fallback", async () => {
  globalThis.fetch = async () => Response.json(response(0.9));
  const ai = { run: async () => { throw new Error("fallback should not run"); } };
  const result = await judgeWithJev("accounting", candidates, [], "test-key", ai);
  assert.deepEqual(result, { verdict: { scores: [0.9], tokens: 12 } });
});

test("uses Cloudflare Jev after gateway service errors", async () => {
  let gatewayCalls = 0;
  globalThis.fetch = async () => { gatewayCalls++; return new Response(null, { status: 503 }); };
  const ai = { run: async (model) => {
    assert.equal(model, "typesafe/jev");
    return response(0.8);
  } };
  const result = await judgeWithJev("accounting", candidates, [], "test-key", ai);
  assert.equal(gatewayCalls, 3);
  assert.deepEqual(result, { verdict: { scores: [0.8], tokens: 12 } });
});

test("uses Vercel's evaluation API when its TypeSafe route returns 503", async () => {
  globalThis.fetch = async (url) => url.includes("/v1/evaluate")
    ? Response.json({ answers: { c0: { probability: 0.7 } }, usage: { inputTokens: 10 } })
    : new Response(null, { status: 503 });
  const ai = { run: async () => { throw new Error("Cloudflare fallback should not run"); } };
  const result = await judgeWithJev("accounting", candidates, [], "test-key", ai);
  assert.deepEqual(result, { verdict: { scores: [0.7], tokens: 10 } });
});

test("preserves the gateway status when both routes fail", async () => {
  let gatewayCalls = 0;
  globalThis.fetch = async () => { gatewayCalls++; return new Response(null, { status: 429 }); };
  const ai = { run: async () => { throw new Error("Cloudflare unavailable"); } };
  const result = await judgeWithJev("accounting", candidates, [], "test-key", ai);
  assert.equal(gatewayCalls, 1);
  assert.deepEqual(result, { verdict: null, reason: "gateway_http_429" });
});

test("reports a bad gateway key without switching billing providers", async () => {
  globalThis.fetch = async () => new Response(null, { status: 401 });
  const ai = { run: async () => { throw new Error("fallback should not run"); } };
  const result = await judgeWithJev("accounting", candidates, [], "test-key", ai);
  assert.deepEqual(result, { verdict: null, reason: "gateway_http_401" });
});

test("does not invoke Jev when no gateway key is configured", async () => {
  globalThis.fetch = async () => { throw new Error("gateway should not run"); };
  const ai = { run: async () => { throw new Error("fallback should not run"); } };
  const result = await judgeWithJev("accounting", candidates, [], undefined, ai);
  assert.deepEqual(result, { verdict: null, reason: "missing_key" });
});
