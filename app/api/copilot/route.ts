import { requireAuthorization } from "@/server/auth/authorization";
import { askCopilot, copilotHistory } from "@/server/services/copilot-service";
import { copilotPromptSchema } from "@/schemas/copilot";
import { failure } from "@/types/result";

export const maxDuration = 60;

function streamReply(reply: string, metadata: unknown) {
  const encoder = new TextEncoder();
  const chunks = reply.match(/.{1,80}(?:\s|$)|\S+\s*/g) ?? [reply];
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`event: meta\ndata: ${JSON.stringify(metadata)}\n\n`),
      );
      for (const chunk of chunks)
        controller.enqueue(
          encoder.encode(`event: token\ndata: ${JSON.stringify(chunk)}\n\n`),
        );
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      controller.close();
    },
  });
}

export async function GET(request: Request) {
  try {
    const context = await requireAuthorization();
    const dashboardId = new URL(request.url).searchParams.get("dashboardId");
    if (!dashboardId)
      return Response.json(
        failure("VALIDATION_ERROR", "Dashboard is required."),
        { status: 422 },
      );
    const result = await copilotHistory(context, dashboardId);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch {
    return Response.json(
      failure("FORBIDDEN", "AI Copilot access is not available."),
      { status: 403 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAuthorization();
    const parsed = copilotPromptSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        failure("VALIDATION_ERROR", "Enter a valid copilot message."),
        { status: 422 },
      );
    const result = await askCopilot(context, parsed.data);
    if (!result.ok) return Response.json(result, { status: 422 });
    return new Response(streamReply(result.data.answer, result.data), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch {
    return Response.json(
      failure("FORBIDDEN", "AI Copilot access is not available."),
      { status: 403 },
    );
  }
}
