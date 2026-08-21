import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { attachmentContentDisposition } from "@/server/http/content-disposition";

function safeFileName(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .match(/./gu)
      ?.slice(0, 80)
      .join("") || "conversation"
  );
}

export async function GET(request: Request) {
  const context = await requireAuthorization();
  await requirePermission(context, "chat.use");
  const id = new URL(request.url).searchParams.get("conversation");
  if (!id)
    return Response.json(
      { message: "Conversation is required." },
      { status: 400 },
    );
  const conversation = await db.conversation.findFirst({
    where: {
      id,
      organizationId: context.organizationId,
      userId: context.userId,
      isUniversal: true,
      deletedAt: null,
    },
    include: {
      bot: { select: { name: true } },
      messages: {
        where: { role: { in: ["USER", "ASSISTANT"] } },
        include: { citations: { orderBy: { rank: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!conversation)
    return Response.json(
      { message: "Conversation not found." },
      { status: 404 },
    );
  const markdown = [
    `# ${conversation.title}`,
    "",
    `Bot: ${conversation.bot.name}`,
    "",
    ...conversation.messages.flatMap((message) => [
      `## ${message.role === "USER" ? "User" : "Assistant"}`,
      "",
      message.content,
      ...message.citations.map(
        (citation) => `\n[${citation.rank}] ${citation.quote}`,
      ),
      "",
    ]),
  ].join("\n");
  const fileName = `${safeFileName(conversation.title)}.md`;
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": attachmentContentDisposition(
        fileName,
        "conversation.md",
      ),
      "cache-control": "private, no-store",
    },
  });
}
