import {
  CHAT_MODEL,
  SUMMARY_MAX_TOKENS,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  getClient,
  type SummaryLead,
} from "@/lib/claude";

export const runtime = "nodejs";

type Body = {
  filters: {
    branche: string;
    fte_klassen: string[];
    regio_center: { lat: number; lng: number } | null;
    regio_straal_km: number;
  };
  leads: SummaryLead[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (!Array.isArray(body.leads) || body.leads.length === 0) {
    return new Response("Missing leads", { status: 400 });
  }

  let client;
  try {
    client = getClient();
  } catch (err) {
    return new Response(String(err instanceof Error ? err.message : err), {
      status: 503,
    });
  }

  // The system prompt is static per-deployment — cache it so a second
  // search in the same ~5min window reads from cache instead of
  // repaying the system-prompt tokens.
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: SUMMARY_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: buildSummarySystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: buildSummaryUserPrompt(body.filters, body.leads) },
    ],
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
        const msg = err instanceof Error ? err.message : "Unknown error";
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
