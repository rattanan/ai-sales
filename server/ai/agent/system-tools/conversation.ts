import { z } from "zod";
import { db } from "@/server/db";
import { lexicalOverlap } from "@/server/services/retrieval-service";
import {
  defineAgentTool,
  toolSuccess,
  type GroundingEvidence,
} from "@/server/ai/agent/types";

const querySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("คำค้นหรือหัวข้อที่ต้องการค้น ใช้ภาษาเดียวกับผู้ใช้"),
});

export const searchConversationHistory = defineAgentTool({
  name: "search_conversation_history",
  kind: "SYSTEM",
  access: "READ",
  group: "HISTORY",
  description:
    "ค้นหาข้อความในบทสนทนาเก่าของผู้ใช้คนนี้เอง ใช้เมื่อผู้ใช้อ้างถึงสิ่งที่เคยคุยกันไว้ เช่น 'ที่ถามไปเมื่อวาน' หรือ 'สรุปที่คุยกันเรื่องนั้น' " +
    "ไม่ใช่การค้นเนื้อหาในเอกสารองค์กร (กรณีนั้นให้ใช้ search_documents) " +
    "ค้นได้เฉพาะบทสนทนาของผู้ใช้คนปัจจุบันเท่านั้น",
  parameters: querySchema,
  async execute(context, args) {
    const messages = await db.chatMessage.findMany({
      where: {
        id: { not: context.currentMessageId },
        role: { in: ["USER", "ASSISTANT"] },
        conversation: {
          organizationId: context.authorization.organizationId,
          userId: context.authorization.userId,
          deletedAt: null,
        },
      },
      include: { conversation: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const evidence: GroundingEvidence[] = messages
      .map((message) => ({
        message,
        score: lexicalOverlap(args.query, message.content),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)
      .map(({ message, score }) => ({
        content: message.content,
        contentHash: message.id,
        metadata: {
          sourceType: "CONVERSATION_HISTORY",
          conversationId: message.conversation.id,
          messageId: message.id,
        },
        documentId: message.conversation.id,
        sourceId: message.conversation.id,
        documentName: `Conversation: ${message.conversation.title}`,
        mimeType: "application/vnd.insightkm.conversation",
        vectorScore: 0,
        keywordScore: score,
        score,
      }));
    if (!evidence.length)
      return toolSuccess("ไม่พบข้อความในบทสนทนาเก่าที่ตรงกับคำค้นนี้");
    return toolSuccess(
      `พบข้อความที่เกี่ยวข้อง ${evidence.length} รายการจากบทสนทนาเก่า`,
      evidence,
    );
  },
});

export const searchBusinessInsights = defineAgentTool({
  name: "search_business_insights",
  kind: "SYSTEM",
  access: "READ",
  group: "INSIGHT",
  description:
    "ค้นหาผลวิเคราะห์ Business Insight ที่ระบบเคยประมวลผลไว้ให้ผู้ใช้คนนี้ (ตัวชี้วัด หัวข้อที่พบ ข้อค้นพบ และข้อจำกัดของแต่ละช่วงเวลา) " +
    "ใช้เมื่อผู้ใช้ถามถึงสรุปเชิงธุรกิจหรือแนวโน้มที่วิเคราะห์ไว้แล้ว " +
    "ไม่ใช่การรันตัวเลขใหม่จากฐานข้อมูล (กรณีนั้นให้ใช้ query_database)",
  parameters: querySchema,
  async execute(context, args) {
    const snapshots = await db.businessInsightSnapshot.findMany({
      where: {
        job: {
          organizationId: context.authorization.organizationId,
          workspaceId: context.authorization.workspaceId,
          requestedById: context.authorization.userId,
          status: { in: ["COMPLETED", "INSUFFICIENT_DATA"] },
        },
      },
      include: { job: { select: { id: true, dateFrom: true, dateTo: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const evidence: GroundingEvidence[] = snapshots
      .map((snapshot) => {
        const content = JSON.stringify({
          period: [snapshot.job.dateFrom, snapshot.job.dateTo],
          metrics: snapshot.metrics,
          topics: snapshot.topics,
          findings: snapshot.findings,
          limitations: snapshot.limitations,
        });
        return { snapshot, content, score: lexicalOverlap(args.query, content) };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)
      .map(({ snapshot, content, score }) => ({
        content,
        contentHash: snapshot.id,
        metadata: {
          sourceType: "BUSINESS_INSIGHT",
          insightJobId: snapshot.job.id,
          snapshotId: snapshot.id,
        },
        documentId: snapshot.job.id,
        sourceId: snapshot.job.id,
        documentName: `Business insight ${snapshot.job.dateFrom.toISOString().slice(0, 10)} – ${snapshot.job.dateTo.toISOString().slice(0, 10)}`,
        mimeType: "application/vnd.insightkm.business-insight",
        vectorScore: 0,
        keywordScore: score,
        // Snapshots are few and already scoped to this user, so a weak lexical
        // match still beats returning nothing at all.
        score: Math.max(score, 0.1),
      }));
    if (!evidence.length)
      return toolSuccess("ยังไม่มีผลวิเคราะห์ Business Insight สำหรับผู้ใช้คนนี้");
    return toolSuccess(
      `พบผลวิเคราะห์ ${evidence.length} ชุดที่เกี่ยวข้อง`,
      evidence,
    );
  },
});
