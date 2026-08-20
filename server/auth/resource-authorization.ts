import type {
  ResourceAccessLevel,
  ResourceType,
} from "@/generated/prisma/enums";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

const accessRank: Record<ResourceAccessLevel, number> = {
  VIEW: 1,
  USE: 2,
  EDIT: 3,
  MANAGE: 4,
};

export type ResourceAuthorizationDecision = {
  allowed: boolean;
  reason: string;
  precedence: string[];
  inheritedFrom?: { resourceType: ResourceType; resourceId: string };
};

async function resourceScope(
  organizationId: string,
  resourceType: ResourceType,
  resourceId: string,
) {
  switch (resourceType) {
    case "BOT":
      return db.bot.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true, active: true },
      });
    case "KNOWLEDGE_RACK":
      return db.knowledgeRack.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true, active: true },
      });
    case "KNOWLEDGE_SOURCE":
      return db.knowledgeSource.findFirst({
        where: { id: resourceId, rack: { organizationId } },
        select: { id: true, active: true, rackId: true },
      });
    case "DOCUMENT":
      return db.document.findFirst({
        where: { id: resourceId, organizationId },
        select: {
          id: true,
          active: true,
          source: { select: { rackId: true } },
        },
      });
    case "DATA_SOURCE":
      return db.dataSource.findFirst({
        where: { id: resourceId, workspace: { organizationId } },
        select: { id: true, status: true },
      });
    case "CHAT":
      return db.conversation.findFirst({
        where: { id: resourceId, organizationId, deletedAt: null },
        select: { id: true, userId: true },
      });
    case "DATABASE_SCHEMA":
    case "DATABASE_TABLE": {
      const dataSourceId = resourceId.split(":", 1)[0];
      return db.dataSource.findFirst({
        where: { id: dataSourceId, workspace: { organizationId } },
        select: { id: true, status: true },
      });
    }
    case "LEGACY_API":
      return db.legacyApi.findFirst({
        where: { id: resourceId, organizationId, enabled: true },
        select: { id: true, enabled: true },
      });
    case "INSIGHT":
      return db.businessInsightJob.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true, requestedById: true },
      });
  }
}

function grantsRequiredLevel(
  entry: { accessLevel: ResourceAccessLevel },
  required: ResourceAccessLevel,
) {
  return accessRank[entry.accessLevel] >= accessRank[required];
}

export async function authorizeResource(
  context: AuthorizationContext,
  resourceType: ResourceType,
  resourceId: string,
  required: ResourceAccessLevel = "VIEW",
): Promise<ResourceAuthorizationDecision> {
  const precedence: string[] = [];
  const resource = await resourceScope(
    context.organizationId,
    resourceType,
    resourceId,
  );
  if (!resource) {
    return {
      allowed: false,
      reason: "TENANT_SCOPE_OR_RESOURCE_NOT_FOUND",
      precedence,
    };
  }
  precedence.push("tenant-scope:pass");
  const roleIds = await db.userRole
    .findMany({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
      },
      select: { roleId: true },
    })
    .then((rows) => rows.map(({ roleId }) => roleId));
  const explicit = await db.resourceAcl.findMany({
    where: {
      organizationId: context.organizationId,
      resourceType,
      resourceId,
      OR: [{ userId: context.userId }, { roleId: { in: roleIds } }],
    },
  });
  const deny = explicit.find(
    (entry) => entry.effect === "DENY" && grantsRequiredLevel(entry, required),
  );
  if (deny) {
    precedence.push(deny.userId ? "explicit-user-deny" : "explicit-role-deny");
    return { allowed: false, reason: "EXPLICIT_DENY", precedence };
  }
  const allow = explicit
    .filter(
      (entry) =>
        entry.effect === "ALLOW" && grantsRequiredLevel(entry, required),
    )
    .sort(
      (left, right) =>
        Number(Boolean(right.userId)) - Number(Boolean(left.userId)),
    )[0];
  if (allow) {
    precedence.push(
      allow.userId ? "explicit-user-allow" : "explicit-role-allow",
    );
    return { allowed: true, reason: "EXPLICIT_ALLOW", precedence };
  }
  precedence.push("explicit-acl:no-match");
  if (resourceType === "BOT") {
    if (await hasPermission(context, "bot.manage"))
      return { allowed: true, reason: "MANAGEMENT_PERMISSION", precedence };
    if (
      !(await hasPermission(context, "bot.use")) ||
      !("active" in resource && resource.active)
    )
      return {
        allowed: false,
        reason: "BOT_PERMISSION_OR_STATUS_DENIED",
        precedence,
      };
    const assigned = await db.botAccess.count({
      where: {
        botId: resourceId,
        organizationId: context.organizationId,
        OR: [{ userId: context.userId }, { roleId: { in: roleIds } }],
      },
    });
    return {
      allowed: assigned > 0,
      reason: assigned ? "BOT_ASSIGNMENT" : "DENY_BY_DEFAULT",
      precedence,
    };
  }
  if (resourceType === "KNOWLEDGE_RACK") {
    if (await hasPermission(context, "knowledge.manage"))
      return { allowed: true, reason: "MANAGEMENT_PERMISSION", precedence };
    if (!(await hasPermission(context, "knowledge.view")))
      return {
        allowed: false,
        reason: "KNOWLEDGE_PERMISSION_DENIED",
        precedence,
      };
    const legacyLevel =
      required === "MANAGE"
        ? "MANAGE"
        : required === "EDIT"
          ? "UPLOAD"
          : "READ";
    const levels = { READ: 1, UPLOAD: 2, MANAGE: 3 } as const;
    const access = await db.knowledgeRackAccess.findMany({
      where: {
        rackId: resourceId,
        organizationId: context.organizationId,
        OR: [{ userId: context.userId }, { roleId: { in: roleIds } }],
      },
      select: { level: true },
    });
    const allowed = access.some(
      ({ level }) => levels[level] >= levels[legacyLevel],
    );
    return {
      allowed,
      reason: allowed ? "RACK_ASSIGNMENT" : "DENY_BY_DEFAULT",
      precedence,
    };
  }
  if (resourceType === "KNOWLEDGE_SOURCE" && "rackId" in resource) {
    const inherited = await authorizeResource(
      context,
      "KNOWLEDGE_RACK",
      String(resource.rackId),
      required,
    );
    return {
      ...inherited,
      inheritedFrom: {
        resourceType: "KNOWLEDGE_RACK",
        resourceId: String(resource.rackId),
      },
      precedence: [...precedence, ...inherited.precedence],
    };
  }
  if (
    resourceType === "DOCUMENT" &&
    "source" in resource &&
    resource.source &&
    typeof resource.source === "object" &&
    "rackId" in resource.source
  ) {
    const rackId = String(resource.source.rackId);
    const inherited = await authorizeResource(
      context,
      "KNOWLEDGE_RACK",
      rackId,
      required,
    );
    return {
      ...inherited,
      inheritedFrom: { resourceType: "KNOWLEDGE_RACK", resourceId: rackId },
      precedence: [...precedence, ...inherited.precedence],
    };
  }
  if (resourceType === "DATA_SOURCE") {
    if (await hasPermission(context, "datasource.update"))
      return { allowed: true, reason: "MANAGEMENT_PERMISSION", precedence };
    const access = await db.dataSourceAccess.findUnique({
      where: {
        dataSourceId_userId: {
          dataSourceId: resourceId,
          userId: context.userId,
        },
      },
    });
    const allowed = Boolean(
      access &&
      (required === "MANAGE"
        ? access.canManage
        : required === "EDIT"
          ? access.canBuild || access.canManage
          : access.canPreview),
    );
    return {
      allowed,
      reason: allowed ? "DATA_SOURCE_ASSIGNMENT" : "DENY_BY_DEFAULT",
      precedence,
    };
  }
  if (
    (resourceType === "DATABASE_SCHEMA" || resourceType === "DATABASE_TABLE") &&
    "id" in resource
  ) {
    const inherited = await authorizeResource(
      context,
      "DATA_SOURCE",
      String(resource.id),
      required,
    );
    return {
      ...inherited,
      inheritedFrom: {
        resourceType: "DATA_SOURCE",
        resourceId: String(resource.id),
      },
      precedence: [...precedence, ...inherited.precedence],
    };
  }
  if (resourceType === "CHAT" && "userId" in resource) {
    if (resource.userId === context.userId)
      return { allowed: true, reason: "RESOURCE_OWNER", precedence };
    const allowed = await hasPermission(context, "chat.audit");
    return {
      allowed,
      reason: allowed ? "CHAT_AUDIT_PERMISSION" : "DENY_BY_DEFAULT",
      precedence,
    };
  }
  if (
    resourceType === "LEGACY_API" &&
    (await hasPermission(context, "legacy_api.manage"))
  )
    return { allowed: true, reason: "MANAGEMENT_PERMISSION", precedence };
  if (
    resourceType === "INSIGHT" &&
    (await hasPermission(context, "insight.manage"))
  )
    return { allowed: true, reason: "MANAGEMENT_PERMISSION", precedence };
  if (
    resourceType === "INSIGHT" &&
    "requestedById" in resource &&
    resource.requestedById === context.userId
  )
    return { allowed: true, reason: "RESOURCE_OWNER", precedence };
  return { allowed: false, reason: "DENY_BY_DEFAULT", precedence };
}

export async function requireResourceAccess(
  context: AuthorizationContext,
  resourceType: ResourceType,
  resourceId: string,
  required: ResourceAccessLevel = "VIEW",
) {
  const decision = await authorizeResource(
    context,
    resourceType,
    resourceId,
    required,
  );
  if (!decision.allowed) throw new Error("NOT_FOUND");
  return context;
}
