import type { AuthorizationContext } from "@/server/auth/authorization";
import { requireBotUse } from "@/server/auth/knowledge-access";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { db } from "@/server/db";
import { embedKnowledgeQuery } from "@/server/services/embedding-service";

type RetrievalRow = {
  chunkId: string;
  content: string;
  contentHash: string;
  metadata: Record<string, string | number> | null;
  documentId: string;
  sourceId: string;
  documentName: string;
  mimeType: string;
  vectorScore: number;
  keywordScore: number;
};

export type RetrievedKnowledge = RetrievalRow & { score: number };

export interface KnowledgeReranker {
  rerank(input: {
    query: string;
    candidates: RetrievedKnowledge[];
  }): Promise<RetrievedKnowledge[]>;
}

const INJECTION_PATTERN =
  /ignore\s+(all\s+)?(previous|prior)|system\s+prompt|developer\s+message|follow\s+these\s+instructions|do\s+not\s+cite|ละเว้นคำสั่ง|คำสั่งระบบ|เปิดเผยพรอมต์/i;

export function sanitizeRetrievedContent(content: string) {
  return content
    .split("\n")
    .filter((line) => !INJECTION_PATTERN.test(line))
    .join("\n")
    .trim();
}

function queryTerms(query: string) {
  return new Set(
    query
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length > 1),
  );
}

function lexicalOverlap(query: string, content: string) {
  const terms = queryTerms(query);
  if (!terms.size) return 0;
  const normalized = content.toLocaleLowerCase();
  return (
    [...terms].filter((term) => normalized.includes(term)).length / terms.size
  );
}

export async function retrieveBotContext(
  context: AuthorizationContext,
  botId: string,
  query: string,
  options?: {
    reranker?: KnowledgeReranker;
    allAccessible?: boolean;
    sourceIds?: string[];
  },
) {
  await requireBotUse(context, botId);
  const bot = await db.bot.findFirst({
    where: { id: botId, organizationId: context.organizationId },
    include: { providerConfig: true },
  });
  if (!bot) return [];
  const rackAssignments =
    options?.allAccessible || options?.sourceIds?.length
      ? await db.knowledgeRack
          .findMany({
            where: { organizationId: context.organizationId, active: true },
            select: { id: true },
          })
          .then((items) => items.map((item) => ({ rackId: item.id })))
      : await db.knowledgeRack
          .findMany({
            where: {
              organizationId: context.organizationId,
              active: true,
              OR: [
                { scope: "GLOBAL" },
                { bots: { some: { botId } } },
                {
                  sources: {
                    some: {
                      active: true,
                      OR: [
                        { scope: "GLOBAL" },
                        {
                          botAssignments: {
                            some: { botId, enabled: true },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
            select: { id: true },
          })
          .then((items) => items.map((item) => ({ rackId: item.id })));
  const rackDecisions = await Promise.all(
    rackAssignments.map(async ({ rackId }) => ({
      rackId,
      allowed: (
        await authorizeResource(context, "KNOWLEDGE_RACK", rackId, "VIEW")
      ).allowed,
    })),
  );
  const authorizedRackIds = rackDecisions
    .filter(({ allowed }) => allowed)
    .map(({ rackId }) => rackId);
  if (!authorizedRackIds.length) return [];
  let vector: number[] | null = null;
  try {
    vector = (
      await embedKnowledgeQuery(
        context.organizationId,
        query,
        bot.providerConfig?.providerId,
      )
    ).embedding;
  } catch {
    // Keyword retrieval remains available during an embedding-provider outage.
  }
  const vectorAclSql = `
    FROM "DocumentChunk" c
    JOIN "DocumentVersion" v ON v.id = c."documentVersionId"
    JOIN "Document" d ON d."currentVersionId" = v.id AND d.active = true
    JOIN "KnowledgeSource" s ON s.id = d."sourceId" AND s.active = true
    JOIN "KnowledgeRack" r ON r.id = s."rackId" AND r.active = true
    WHERE d."organizationId" = $2
      AND v.status = 'INDEXED'
      AND s.status = 'READY'
      AND r.id = ANY($3::text[])
      AND ($7::boolean OR s.scope = 'GLOBAL' OR EXISTS (
        SELECT 1 FROM "BotKnowledgeSource" bks
        WHERE bks."sourceId" = s.id AND bks."botId" = $1 AND bks.enabled = true
      ) OR EXISTS (
        SELECT 1 FROM "BotKnowledgeRack" br
        WHERE br."rackId" = r.id AND br."botId" = $1
          AND NOT EXISTS (
            SELECT 1 FROM "BotKnowledgeSource" override
            WHERE override."sourceId" = s.id
          )
      ))
      AND (cardinality($8::text[]) = 0 OR s.id = ANY($8::text[]))`;
  const keywordAclSql = vectorAclSql
    .replaceAll("$7", "$5")
    .replaceAll("$8", "$6");
  // pgvector HNSW supports up to 2,000 dimensions. Larger embeddings retain
  // the generic vector expression and therefore use the exact-scan path.
  const indexedDimensions = new Set([384, 768, 1024, 1536]);
  const vectorDistance =
    vector && indexedDimensions.has(vector.length)
      ? `c.embedding::vector(${vector.length}) <=> $4::vector(${vector.length})`
      : "c.embedding <=> $4::vector";
  const rows = vector
    ? await db.$queryRawUnsafe<RetrievalRow[]>(
        `SELECT c.id AS "chunkId", c.content, c."contentHash", c.metadata,
                d.id AS "documentId", d.name AS "documentName", d."mimeType",
                s.id AS "sourceId",
                CASE WHEN c."embeddingDimension" = $5
                     THEN 1 - (${vectorDistance}) ELSE 0 END AS "vectorScore",
                ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', $6)) AS "keywordScore"
         ${vectorAclSql}
         ORDER BY (CASE WHEN c."embeddingDimension" = $5
                        THEN 1 - (${vectorDistance}) ELSE 0 END) DESC,
                  "keywordScore" DESC
         LIMIT 40`,
        botId,
        context.organizationId,
        authorizedRackIds,
        `[${vector.join(",")}]`,
        vector.length,
        query,
        Boolean(options?.allAccessible),
        options?.sourceIds ?? [],
      )
    : await db.$queryRawUnsafe<RetrievalRow[]>(
        `SELECT c.id AS "chunkId", c.content, c."contentHash", c.metadata,
                d.id AS "documentId", d.name AS "documentName", d."mimeType",
                s.id AS "sourceId",
                0::float AS "vectorScore",
                ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', $4)) AS "keywordScore"
         ${keywordAclSql}
         ORDER BY "keywordScore" DESC, c."createdAt" DESC
         LIMIT 80`,
        botId,
        context.organizationId,
        authorizedRackIds,
        query,
        Boolean(options?.allAccessible),
        options?.sourceIds ?? [],
      );
  const seen = new Set<string>();
  const candidates = rows
    .map((row) => {
      const content = sanitizeRetrievedContent(row.content);
      const overlap = lexicalOverlap(query, content);
      return {
        ...row,
        content,
        score:
          Math.max(0, Number(row.vectorScore)) * 0.65 +
          Math.max(0, Number(row.keywordScore)) * 0.15 +
          overlap * 0.2,
      };
    })
    .filter((row) => {
      if (!row.content || seen.has(row.contentHash)) return false;
      seen.add(row.contentHash);
      return row.score > 0.08 || row.keywordScore > 0;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
  const ranked = options?.reranker
    ? await options.reranker.rerank({ query, candidates })
    : candidates;
  return ranked.slice(0, 6);
}
