import type {
  MessageParam,
  ContentBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { getLeadSource } from "@/lib/lead-source";
import {
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  buildSystemPrompt,
  getClient,
} from "@/lib/claude";
import {
  LEAD_TOOLS,
  executeLeadTool,
  loadLeadContext,
  newToolBudget,
} from "@/lib/agent/lead-tools";

export const runtime = "nodejs";
// Tool-use loop kan meerdere turns + MCP-calls doen; vraagt extra tijd.
export const maxDuration = 120;

const MAX_AGENT_TURNS = 5;

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

  // Lead-context: kvk + naam komen uit de URL/snapshot, website komt
  // uit de companies-tabel. Tools krijgen 'm pre-bound zodat de agent
  // niet hoeft te raden welke URL de scan gebruikte.
  const leadCtx = await loadLeadContext(kvk, lead.naam).catch(() => ({
    kvk,
    naam: lead.naam,
    websiteUrl: null,
  }));

  const system = buildSystemPrompt(lead, leadCtx.websiteUrl);

  // Conversation-state voor de tool-use loop. Begin met de user-vraag,
  // groei met assistant-turns + tool-results.
  const conversation: MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const budget = newToolBudget();

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
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
            tools: LEAD_TOOLS,
            messages: conversation,
          });

          // Tekst → live naar de UI doorpompen.
          stream.on("text", (delta) => {
            controller.enqueue(encoder.encode(delta));
          });

          const final = await stream.finalMessage();

          if (final.stop_reason !== "tool_use") {
            // Klaar — de stream-text is al naar de UI gegaan.
            controller.close();
            return;
          }

          // Voeg de assistant-turn (incl. tool_use blocks) aan de conversatie toe.
          conversation.push({ role: "assistant", content: final.content });

          // Voer alle tool_use blocks uit + verzamel results.
          const toolUseBlocks = final.content.filter(
            (b): b is ToolUseBlock => b.type === "tool_use",
          );
          const toolResults: ContentBlockParam[] = [];
          for (const block of toolUseBlocks) {
            controller.enqueue(
              encoder.encode(`\n\n[🔧 ${block.name}…]\n`),
            );
            const result = await executeLeadTool(block, budget, leadCtx);
            toolResults.push({
              type: "tool_result",
              tool_use_id: result.toolUseId,
              content: result.content,
              is_error: result.isError,
            });
          }
          conversation.push({ role: "user", content: toolResults });
          controller.enqueue(encoder.encode("\n\n"));
        }

        // Hit MAX_AGENT_TURNS zonder afsluiten — meld dat.
        controller.enqueue(
          encoder.encode(
            `\n\n[Max ${MAX_AGENT_TURNS} agent-turns bereikt. Stel een vervolgvraag als je wilt dat ik dieper ga.]`,
          ),
        );
        controller.close();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error during streaming";
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
        controller.close();
      }
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
