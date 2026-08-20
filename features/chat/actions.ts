"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";
import {
  conversationMutationSchema,
  messageFeedbackSchema,
} from "@/schemas/knowledge";

export async function renameConversationAction(formData: FormData) {
  const context = await requireAuthorization();
  const parsed = conversationMutationSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success || !parsed.data.title) return;
  await db.conversation.updateMany({
    where: {
      id: parsed.data.conversationId,
      organizationId: context.organizationId,
      userId: context.userId,
      deletedAt: null,
    },
    data: { title: parsed.data.title },
  });
  revalidatePath("/workspace/chat");
}

export async function deleteConversationAction(formData: FormData) {
  const context = await requireAuthorization();
  const parsed = conversationMutationSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) return;
  await db.conversation.updateMany({
    where: {
      id: parsed.data.conversationId,
      organizationId: context.organizationId,
      userId: context.userId,
    },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/workspace/chat");
}

export async function submitMessageFeedbackAction(formData: FormData) {
  const context = await requireAuthorization();
  const parsed = messageFeedbackSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false as const, error: "Invalid feedback." };
  const message = await db.chatMessage.findFirst({
    where: {
      id: parsed.data.messageId,
      role: "ASSISTANT",
      conversation: {
        userId: context.userId,
        organizationId: context.organizationId,
      },
    },
  });
  if (!message)
    return { ok: false as const, error: "The answer could not be found." };
  await db.chatMessageFeedback.upsert({
    where: { messageId: message.id },
    update: {
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      reason: parsed.data.reason,
      userId: context.userId,
    },
    create: {
      messageId: message.id,
      userId: context.userId,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      reason: parsed.data.reason,
    },
  });
  revalidatePath("/workspace/chat");
  revalidatePath("/workspace/chat/saved");
  return { ok: true as const, rating: parsed.data.rating };
}
