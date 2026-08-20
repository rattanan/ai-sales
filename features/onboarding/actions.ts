"use server";

import { redirect } from "next/navigation";
import { onboardingSchema } from "@/schemas/auth";
import { requireUser } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { slugify } from "@/lib/utils";
import { failure, success, type AppResult } from "@/types/result";
import { provisionOrganizationSystemRoles } from "@/server/services/system-role-service";

export async function onboardingAction(
  _previous: AppResult<{ created: true }> | null,
  formData: FormData,
) {
  const user = await requireUser();
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Please complete both names.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });

  const baseSlug = slugify(parsed.data.organizationName) || "organization";
  await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: parsed.data.organizationName,
        slug: `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    const workspace = await tx.workspace.create({
      data: {
        name: parsed.data.workspaceName,
        slug: slugify(parsed.data.workspaceName) || "default",
        organizationId: organization.id,
        createdById: user.id,
      },
    });
    await provisionOrganizationSystemRoles(tx, organization.id, user.id);
    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        actorId: user.id,
        action: "ORGANIZATION_CREATED",
        entityType: "Organization",
        entityId: organization.id,
      },
    });
  });
  redirect("/workspace");
  return success({ created: true as const });
}
