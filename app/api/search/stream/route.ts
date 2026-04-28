import { getLeadSource } from "@/lib/lead-source";
import type { SearchFilters, SearchProgressEvent } from "@/lib/adapters/types";

// Server-Sent Events variant van /api/search. De ProductionLeadSource
// emitteert `SearchProgressEvent`s tijdens de flow; wij serialiseren ze
// als SSE-frames zodat de UI echte voortgang kan tonen in plaats van
// de fake setTimeout-stappen.
//
// Protocol: elke frame is één regel `data: <json>\n\n`. Event-types:
//   stage      — nieuwe fase ("kvk", "geo", "scrape", "score")
//   kvk        — aantal kandidaten gevonden
//   geo        — overgebleven na regio-filter
//   scrape     — per bedrijf dat klaar is
//   score      — per gescoorde lead
//   done       — eindtotalen
//   error      — pipeline-faling
//   result     — volledige SearchResult (laatste frame vóór done)
//
// De UI sluit de stream wanneer 'done' (of 'error') is ontvangen.

export const dynamic = "force-dynamic";
// Vercel Pro = 800s, Hobby = 60s. We zetten 'm op 800; voor Hobby
// wordt het automatisch gecapt. SSE-stream emitteert ondertussen
// keep-alive comments zodat de client niet timeoutet.
export const maxDuration = 800;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "true";
  const filters = (await req.json()) as SearchFilters;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: { type: string } & Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Client gone — swallow; runSearch has no way to cancel but
          // will finish naturally.
        }
      };

      // Heartbeat-comment iedere 15s zodat reverse proxies (Vercel,
      // CloudFlare) de SSE-connectie niet droppen op idle timeouts.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          // ignore
        }
      }, 15_000);
      heartbeat.unref?.();

      try {
        const source = getLeadSource();
        const result = await source.runSearch(filters, {
          refresh,
          onEvent: (e: SearchProgressEvent) => send(e),
        });
        send({ type: "result", result });
        // If the source didn't emit "done" itself (e.g. the mock-source),
        // synthesize one so the client always sees a terminal frame.
        send({ type: "stream-closed" });
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
