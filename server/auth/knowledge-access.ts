import type { AuthorizationContext } from "@/server/auth/authorization";
import { authorizeResource } from "@/server/auth/resource-authorization";

type KnowledgeAccessLevel = "READ" | "UPLOAD" | "MANAGE";

export async function canUseBot(context: AuthorizationContext, botId: string) {
  return (await authorizeResource(context, "BOT", botId, "USE")).allowed;
}

export async function requireBotUse(
  context: AuthorizationContext,
  botId: string,
) {
  if (!(await canUseBot(context, botId))) throw new Error("NOT_FOUND");
  return context;
}

export async function canAccessKnowledgeRack(
  context: AuthorizationContext,
  rackId: string,
  required: KnowledgeAccessLevel = "READ",
) {
  const mapped =
    required === "MANAGE" ? "MANAGE" : required === "UPLOAD" ? "EDIT" : "VIEW";
  return (await authorizeResource(context, "KNOWLEDGE_RACK", rackId, mapped))
    .allowed;
}

export async function requireKnowledgeRackAccess(
  context: AuthorizationContext,
  rackId: string,
  required: KnowledgeAccessLevel = "READ",
) {
  if (!(await canAccessKnowledgeRack(context, rackId, required)))
    throw new Error("NOT_FOUND");
  return context;
}
