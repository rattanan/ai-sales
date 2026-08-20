"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  copiedTextSourceSchema,
  sharedFolderSourceSchema,
  sourceAssignmentSchema,
  webSourceSchema,
} from "@/schemas/knowledge";
import { requireAuthorization } from "@/server/auth/authorization";
import { requireKnowledgeRackAccess } from "@/server/auth/knowledge-access";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import {
  createSharedFolderSource,
  createWebSource,
} from "@/server/services/source-operations";
import {
  saveCopiedTextSource,
  updateSourceAssignment,
} from "@/server/services/unified-source-service";
import { failure, success } from "@/types/result";

const commonSchema = z
  .object({
    kind: z.enum(["FILE", "COPIED_TEXT", "WEB", "SHARED_FOLDER"]),
    rackId: z.string().min(1),
    name: z.string().trim().min(2).max(120),
    scope: z.enum(["GLOBAL", "SELECTED_BOTS"]),
    botIds: z.array(z.string().min(1)).max(200),
  })
  .superRefine((value, context) => {
    if (value.scope === "SELECTED_BOTS" && !value.botIds.length)
      context.addIssue({
        code: "custom",
        path: ["botIds"],
        message: "Select at least one bot or choose All bots.",
      });
  });

function revalidateKnowledge() {
  revalidatePath("/workspace/sources");
  revalidatePath("/workspace/admin/knowledge");
  revalidatePath("/workspace/admin/knowledge/sources");
}

export async function addKnowledgeAction(_state: unknown, formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const raw = Object.fromEntries(formData);
  const common = commonSchema.safeParse({
    ...raw,
    botIds: formData.getAll("botIds"),
  });
  if (!common.success)
    return failure("VALIDATION_ERROR", "Check the access settings.", {
      fieldErrors: common.error.flatten().fieldErrors,
    });

  const validBotCount = await db.bot.count({
    where: {
      id: { in: common.data.botIds },
      organizationId: context.organizationId,
    },
  });
  if (validBotCount !== new Set(common.data.botIds).size)
    return failure(
      "VALIDATION_ERROR",
      "One or more selected bots are invalid.",
    );
  await requireKnowledgeRackAccess(context, common.data.rackId, "MANAGE");

  if (common.data.kind === "COPIED_TEXT") {
    const parsed = copiedTextSourceSchema.safeParse({
      ...raw,
      rackId: common.data.rackId,
      name: common.data.name,
      scope: common.data.scope,
      botIds: common.data.botIds,
      tags: String(formData.get("tags") ?? "")
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    });
    if (!parsed.success)
      return failure("VALIDATION_ERROR", "Check the copied text details.", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    const result = await saveCopiedTextSource(context, parsed.data);
    if (result.ok) revalidateKnowledge();
    return result;
  }

  if (common.data.kind === "FILE") {
    const fileName = String(formData.get("fileName") ?? "").trim();
    if (!/\.(pdf|docx|xlsx|csv|txt|md|markdown|html|htm)$/i.test(fileName))
      return failure("FILE_INVALID", "Choose a supported file to upload.");
    try {
      const source = await db.knowledgeSource.create({
        data: {
          rackId: common.data.rackId,
          name: common.data.name,
          type: "FILE",
          status: "DRAFT",
          scope: common.data.scope,
          createdById: context.userId,
          botAssignments: common.data.botIds.length
            ? {
                create: common.data.botIds.map((botId, index) => ({
                  botId,
                  priority: 100 + index,
                })),
              }
            : undefined,
        },
        select: { id: true },
      });
      // Do not revalidate here. A Server Action revalidation sends a fresh RSC
      // tree in the same response and can remount the wizard before its
      // follow-up Route Handler upload reads the selected File. The client
      // refreshes the knowledge pages after that upload succeeds.
      return success({ id: source.id, uploadRequired: true as const });
    } catch {
      return failure(
        "CONFLICT",
        "A knowledge source with this name already exists in the folder.",
      );
    }
  }

  const created =
    common.data.kind === "WEB"
      ? await (async () => {
          const parsed = webSourceSchema.safeParse({
            ...raw,
            rackId: common.data.rackId,
            name: common.data.name,
            allowedDomains: String(formData.get("allowedDomains") ?? "")
              .split(/[,\n]/)
              .map((item) => item.trim())
              .filter(Boolean),
          });
          if (!parsed.success)
            return failure("VALIDATION_ERROR", "Check the URL details.", {
              fieldErrors: parsed.error.flatten().fieldErrors,
            });
          return createWebSource(context, parsed.data);
        })()
      : await (async () => {
          const parsed = sharedFolderSourceSchema.safeParse({
            ...raw,
            rackId: common.data.rackId,
            name: common.data.name,
          });
          if (!parsed.success)
            return failure(
              "VALIDATION_ERROR",
              "Check the shared folder details.",
              { fieldErrors: parsed.error.flatten().fieldErrors },
            );
          return createSharedFolderSource(context, parsed.data);
        })();
  if (!created.ok) return created;

  const assigned = await updateSourceAssignment(
    context,
    sourceAssignmentSchema.parse({
      sourceType: "KNOWLEDGE",
      sourceId: created.data.id,
      scope: common.data.scope,
      botIds: common.data.botIds,
      enabled: true,
      priority: 100,
    }),
  );
  if (!assigned.ok) return assigned;
  revalidateKnowledge();
  return success({ id: created.data.id, uploadRequired: false as const });
}
