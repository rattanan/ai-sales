import { z } from "zod";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { generateCachedStructuredOutput } from "@/server/ai/cached-provider";
import { db } from "@/server/db";

const sourcePreviewSchema = z.object({
  summary: z.string().trim().min(1).max(500),
});

export async function summarizeDataSourcePreview(
  context: AuthorizationContext,
  dataSourceId: string,
) {
  const source = await db.dataSource.findFirst({
    where: { id: dataSourceId, workspaceId: context.workspaceId },
    include: {
      file: {
        select: { originalName: true, sheetNames: true, sizeBytes: true },
      },
      schemas: {
        take: 20,
        orderBy: { name: "asc" },
        include: {
          tables: {
            take: 30,
            orderBy: { name: "asc" },
            include: {
              columns: {
                take: 20,
                orderBy: { ordinal: "asc" },
                select: { name: true, dataType: true },
              },
            },
          },
        },
      },
    },
  });
  if (!source) return;
  const input = {
    name: source.name,
    type: source.type,
    description: source.description,
    file: source.file,
    schemas: source.schemas.map((schema) => ({
      name: schema.name,
      tables: schema.tables.map((table) => ({
        name: table.name,
        kind: table.tableType,
        estimatedRows: table.estimatedRowCount?.toString() ?? null,
        columns: table.columns,
      })),
    })),
  };
  const generated = await generateCachedStructuredOutput(context, {
    requestId: crypto.randomUUID(),
    schemaName: "source_preview_summary",
    outputSchema: sourcePreviewSchema,
    promptVersion: "source-preview-v1",
    systemPrompt:
      "Write a brief preview of this data source in 1-2 sentences, no more than 500 characters. Use the source language when clear. Describe only supplied metadata; do not infer values, credentials, or business facts. Return JSON only.",
    userPrompt: JSON.stringify(input).slice(0, 12_000),
  });
  if (!generated.ok) return;
  await db.dataSource.update({
    where: { id: source.id },
    data: {
      previewSummary: generated.data.data.summary,
      previewSummaryAt: new Date(),
      previewSummaryModel: generated.data.model,
    },
  });
}
