import { getLeadSource } from "@/lib/lead-source";
import {
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  buildSystemPrompt,
  getClient,
} from "@/lib/claude";

export const runtime = "nodejs";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(
  req: Request,
  { params }: { params: Promise<{ kvk: string }> },
) {
  const { kvk } = await params;

  let body: { messages: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const messages = (body.messages ?? []).filter(
    (m): m is ChatMessage =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.length > 0,
  );
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response("Expected a non-empty messages array ending in user", {
      status: 400,
    });
  }

  const lead = await getLeadSource().getLead(kvk);
  if (!lead) {
    return new Response("Lead not found", { status: 404 });
  }

  let client;
  try {
    client = getClient();
  } catch (err) {
    return new Response(String(err instanceof Error ? err.message : err), {
      status: 500,
    });
  }

  const system = buildSystemPrompt(lead);

  // cache_control on the system block → follow-up vragen over dezelfde
  // lead raken dezelfde prefix en krijgen ~90% korting op input-tokens.
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: CHAT_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  // Plain text streaming — simplest possible client-side consumption.
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
