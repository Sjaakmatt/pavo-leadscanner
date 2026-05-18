import { getLeadSource } from "@/lib/lead-source";
import {
  BRIEFING_MAX_TOKENS,
  BRIEFING_USER_PROMPT,
  CHAT_MODEL,
  buildSystemPrompt,
  getClient,
} from "@/lib/claude";
import {
  hashLeadInputs,
  loadCachedBriefing,
  saveCachedBriefing,
} from "@/lib/agent/briefing-cache";
import { stripToolTranscripts } from "@/lib/agent/output-sanitize";

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

  const sigHash = hashLeadInputs(lead);
  const encoder = new TextEncoder();

  // Cache-hit: serveer cached markdown zonder LLM-call. Streamt nog
  // steeds (alle in één chunk) zodat de UI dezelfde rendering-pad
  // gebruikt.
  const cached = await loadCachedBriefing(kvk, sigHash).catch(() => null);
  if (cached) {
    return new Response(stripToolTranscripts(cached.briefing_md), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Briefing-Cache": "hit",
      },
    });
  }

  let client;
  try {
    client = getClient();
  } catch (err) {
    return new Response(String(err instanceof Error ? err.message : err), {
      status: 503,
    });
  }

  const system = buildSystemPrompt(lead, null, { toolsEnabled: false });

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

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let captured = "";
      try {
        stream.on("text", (delta) => {
          captured += delta;
        });
        await stream.finalMessage();
        const cleaned = stripToolTranscripts(captured);
        controller.enqueue(encoder.encode(cleaned));
        controller.close();

        // Best-effort persist — faalt deze write stilletjes, dan loopt
        // de UI gewoon door en probeert volgende open opnieuw.
        void saveCachedBriefing(kvk, cleaned, sigHash, CHAT_MODEL).catch(
          (err) => {
            console.warn(
              `[briefing-cache] save faalde voor ${kvk}: ${String(err)}`,
            );
          },
        );
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
      "X-Briefing-Cache": "miss",
    },
  });
}
