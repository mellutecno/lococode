import { config } from "../config.js";

function firstTextFromChoices(choices = []) {
  const first = choices?.[0];
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => p?.text || "").join("").trim();
  }
  return "";
}

export async function callOpenRouterChat({
  messages,
  model,
  maxTokens,
  temperature,
  metadata,
  user,
  timeoutMs,
}, openrouter = config.openrouter) {
  if (openrouter.transport === "mock") {
    const forcedContent = process.env.OPENROUTER_MOCK_SCHEMA_RESPONSE;
    const content = forcedContent || "Risposta AI di test MelluCode.";
    const promptTokens = 12;
    const completionTokens = forcedContent ? Math.max(8, Math.ceil(forcedContent.length / 4)) : 8;
    return {
      id: `mock-${Date.now()}`,
      model,
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        cost: Number(process.env.OPENROUTER_MOCK_COST || "0.00002"),
      },
      reply: content,
    };
  }

  if (!openrouter.apiKey) {
    const err = new Error("OpenRouter non configurato.");
    err.code = "OPENROUTER_NOT_CONFIGURED";
    throw err;
  }

  const controller = new AbortController();
  const effectiveTimeoutMs = Number(timeoutMs || openrouter.timeoutMs || 120000);
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  const body = {
    model,
    messages,
    temperature,
    user,
    metadata,
  };

  // In fase di test/prodotto non vogliamo un tappo MelluCode basso che
  // tronca JSON e codice. maxTokens <= 0 significa: lascia fare al provider.
  if (Number(maxTokens) > 0) {
    body.max_tokens = Number(maxTokens);
  }

  try {
    const response = await fetch(`${openrouter.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${openrouter.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": openrouter.appUrl,
        "X-Title": openrouter.appTitle,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const err = new Error(payload?.error?.message || payload?.message || `OpenRouter HTTP ${response.status}`);
      err.code = "OPENROUTER_ERROR";
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    return {
      ...payload,
      reply: firstTextFromChoices(payload.choices),
    };
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error(`Timeout OpenRouter dopo ${Math.round(effectiveTimeoutMs / 1000)} secondi.`);
      timeoutErr.code = "OPENROUTER_TIMEOUT";
      timeoutErr.timeoutMs = effectiveTimeoutMs;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
