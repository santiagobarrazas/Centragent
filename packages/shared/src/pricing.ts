// Coarse model→price map (USD cents per 1M tokens) for autonomy cost visibility.
// Not billing-accurate; good enough to show spend and enforce soft budgets.
type Price = { inputCentsPerMTok: number; outputCentsPerMTok: number };

const PRICES: Record<string, Price> = {
  // Anthropic
  "claude-opus": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
  "claude-sonnet": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "claude-haiku": { inputCentsPerMTok: 80, outputCentsPerMTok: 400 },
  // OpenAI
  "gpt-5": { inputCentsPerMTok: 125, outputCentsPerMTok: 1000 },
  "o4": { inputCentsPerMTok: 110, outputCentsPerMTok: 440 },
  "gpt-4o": { inputCentsPerMTok: 250, outputCentsPerMTok: 1000 }
};

const DEFAULT_PRICE: Price = { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 };

function priceForModel(model: string): Price {
  const id = model.toLowerCase();
  for (const [key, price] of Object.entries(PRICES)) {
    if (id.includes(key)) return price;
  }
  return DEFAULT_PRICE;
}

/** USD cents for a turn's token usage (rounded up). */
export function usageCents(model: string, promptTokens: number, completionTokens: number): number {
  const price = priceForModel(model);
  const cents =
    (promptTokens / 1_000_000) * price.inputCentsPerMTok +
    (completionTokens / 1_000_000) * price.outputCentsPerMTok;
  return Math.ceil(cents);
}
