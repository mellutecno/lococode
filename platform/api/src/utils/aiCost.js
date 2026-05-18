export const MICROS_PER_CREDIT = 1_000_000;

export function creditsToMicros(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * MICROS_PER_CREDIT);
}

export function microsToCredits(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / MICROS_PER_CREDIT;
}

export function nextMonthBoundary(from = new Date()) {
  return new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth() + 1,
    1,
    0, 0, 0, 0
  ));
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .join(" ");
  }
  return "";
}

export function estimateMessageTokens(messages = []) {
  const chars = messages.reduce((sum, msg) => sum + textFromContent(msg?.content).length, 0);
  // Stima prudente: ~4 caratteri per token + overhead per messaggio.
  return Math.max(1, Math.ceil(chars / 4) + messages.length * 6);
}

function usageNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export function normalizeUsage(usage = {}, { fallbackPromptTokens = 0, fallbackCompletionTokens = 0 } = {}) {
  const promptTokens = usageNumber(usage.prompt_tokens ?? usage.promptTokens) || fallbackPromptTokens;
  const completionTokens = usageNumber(usage.completion_tokens ?? usage.completionTokens) || fallbackCompletionTokens;
  const totalTokens = usageNumber(usage.total_tokens ?? usage.totalTokens) || (promptTokens + completionTokens);
  const reasoningTokens = usageNumber(
    usage.reasoning_tokens ??
    usage.reasoningTokens ??
    usage.completion_tokens_details?.reasoning_tokens
  );
  const cachedTokens = usageNumber(
    usage.cached_tokens ??
    usage.cachedTokens ??
    usage.prompt_tokens_details?.cached_tokens
  );

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
    cachedTokens,
  };
}

export function costMicrosFromUsage(usage = {}, totalTokens = 0, fallbackCostPer1kCredits = 0) {
  const directCost = Number(usage.cost ?? usage.total_cost ?? usage.costCredits);
  if (Number.isFinite(directCost) && directCost > 0) {
    return { costMicros: creditsToMicros(directCost), estimated: false };
  }

  const fallback = (Number(totalTokens) / 1000) * Number(fallbackCostPer1kCredits || 0);
  return { costMicros: creditsToMicros(fallback), estimated: true };
}
