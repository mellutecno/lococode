import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creditsToMicros,
  microsToCredits,
  estimateMessageTokens,
  normalizeUsage,
  costMicrosFromUsage,
} from "./aiCost.js";

test("creditsToMicros and microsToCredits convert safely", () => {
  assert.equal(creditsToMicros(0.05), 50000);
  assert.equal(microsToCredits(50000), 0.05);
  assert.equal(creditsToMicros(-1), 0);
});

test("estimateMessageTokens returns a conservative positive estimate", () => {
  const tokens = estimateMessageTokens([
    { role: "user", content: "Ciao, genera una risposta breve." },
    { role: "assistant", content: [{ type: "text", text: "Ok." }] },
  ]);
  assert.ok(tokens >= 10);
});

test("normalizeUsage accepts OpenAI/OpenRouter snake_case fields", () => {
  const usage = normalizeUsage({
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    prompt_tokens_details: { cached_tokens: 2 },
    completion_tokens_details: { reasoning_tokens: 3 },
  });
  assert.deepEqual(usage, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    reasoningTokens: 3,
    cachedTokens: 2,
  });
});

test("costMicrosFromUsage uses direct provider cost when present", () => {
  const result = costMicrosFromUsage({ cost: 0.00123 }, 100, 0.05);
  assert.equal(result.costMicros, 1230);
  assert.equal(result.estimated, false);
});

test("costMicrosFromUsage falls back to token estimate", () => {
  const result = costMicrosFromUsage({}, 2000, 0.01);
  assert.equal(result.costMicros, 20000);
  assert.equal(result.estimated, true);
});
