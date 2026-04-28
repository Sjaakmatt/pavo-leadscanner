// Prompt-injection sanitizer voor classifier user-prompt. Knipt
// XML-fence-markers uit ruwe bron-content zodat een vijandige website
// niet uit de <bron-data>...</bron-data> sandbox kan breken.

export function sanitizeContextHelper(raw: string): string {
  return raw
    .replace(/<\/?bron-data>/gi, "")
    .replace(/<\/?system\b[^>]*>/gi, "")
    .replace(/<\/?instructions?\b[^>]*>/gi, "");
}
