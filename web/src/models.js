// Catalogo modelli mostrato nel selettore admin. Sincronizzato con
// commonModels in web/server/index.js. Ordinati per qualita visiva/costo.
export const COMMON_MODELS = [
  // TIER PREMIUM (top design + code)
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
  // TIER PRO (veloce + buona qualita)
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5-mini",
  "x-ai/grok-4-fast",
  // TIER MEDIA (economico ma decente)
  "moonshotai/kimi-k2.6",
  "google/gemini-2.5-flash",
  "mistralai/mistral-large-2",
  // TIER BASE (economico, coding focus)
  "deepseek/deepseek-v4-pro",
  "qwen/qwen3-coder",
  "meta-llama/llama-4-maverick",
];

export const MODEL_LABELS = {
  // Premium
  "anthropic/claude-sonnet-4.5":   "Claude Sonnet 4.5",
  "openai/gpt-5":                  "GPT-5",
  "google/gemini-2.5-pro":         "Gemini 2.5 Pro",
  // Pro
  "anthropic/claude-haiku-4.5":    "Claude Haiku 4.5",
  "openai/gpt-5-mini":             "GPT-5 mini",
  "x-ai/grok-4-fast":              "Grok 4 Fast",
  // Media
  "moonshotai/kimi-k2.6":          "Kimi K2.6",
  "google/gemini-2.5-flash":       "Gemini 2.5 Flash",
  "mistralai/mistral-large-2":     "Mistral Large 2",
  // Base
  "deepseek/deepseek-v4-pro":      "DeepSeek V4 Pro",
  "qwen/qwen3-coder":              "Qwen3 Coder",
  "meta-llama/llama-4-maverick":   "Llama 4 Maverick",
};
