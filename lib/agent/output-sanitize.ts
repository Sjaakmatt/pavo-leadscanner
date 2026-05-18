const TOOL_TRANSCRIPT_RE =
  /<tool_(?:call|response)\b[^>]*>[\s\S]*?<\/tool_(?:call|response)>/gi;

/**
 * Verwijder tool-transcripten die een model als platte tekst heeft
 * uitgeschreven. Echte tool-use hoort via Anthropic content blocks te lopen,
 * niet als XML/JSON in de consultant-facing output.
 */
export function stripToolTranscripts(text: string): string {
  return text
    .replace(TOOL_TRANSCRIPT_RE, "")
    .replace(/^\s*(?:<tool_(?:call|response)\b[^>]*>|<\/tool_(?:call|response)>)\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
