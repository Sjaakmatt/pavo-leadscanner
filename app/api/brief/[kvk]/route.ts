import { getLeadSource } from "@/lib/lead-source";
import {
  BRIEFING_MAX_TOKENS,
  BRIEFING_USER_PROMPT,
  CHAT_MODEL,
  buildSystemPrompt,
  getClient,
} from "@/lib/claude";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;

  const lead = await getLeadSource().getLead(kvk);
  if (!lead) {
    return new Response("Lead not found", { status: 404 });
  }

  let client;
  try {
    client = getClient();
  } catch (err) {
    return new Response(String(err instanceof Error ? err.message : err), {
      status: 503,
    });
  }

  const system = buildSystemPrompt(lead);

  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: BRIEFING_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: BRIEFING_USER_PROMPT }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        stream.on("text", (delta) => {
          controller.enqueue(encoder.encode(delta));
        });
        await stream.finalMessage();
        controller.close();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error during streaming";
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
