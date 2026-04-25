// Anthropic SDK-client voor classificatie. Gebruikt Haiku 4.5 — goedkoop
// + snel voor signaal-extractie op korte schone tekst (<10K tokens).

import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY ontbreekt voor classificatie-laag.");
  }
  cached = new Anthropic({ apiKey });
  return cached;
}

export function classificationModel(): string {
  return process.env.CLASSIFICATION_MODEL ?? "claude-haiku-4-5-20251001";
}
