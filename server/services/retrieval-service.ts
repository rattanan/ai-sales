import type { AuthorizationContext } from "@/server/auth/authorization";
import { requireBotUse } from "@/server/auth/knowledge-access";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { db } from "@/server/db";
import { embedKnowledgeQuery } from "@/server/services/embedding-service";
import { logger } from "@/server/services/logger";

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
  /** Absent on evidence a tool synthesised rather than retrieved from a chunk. */
  trigramScore?: number;
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

export function lexicalOverlap(query: string, content: string) {
  const terms = queryTerms(query);
  if (!terms.size) return 0;
  const normalized = content.toLocaleLowerCase();
  return (
    [...terms].filter((term) => normalized.includes(term)).length / terms.size
  );
}

/**
 * Lowest trigram word similarity that admits a chunk on its own. Measured
 * against the indexed corpus: Thai queries whose wording appears in a document
 * scored 0.39-1.00, while a query about an unrelated subject peaked at 0.20.
 */
const TRIGRAM_FLOOR = 0.3;

/**
 * Blends the three retrieval signals and decides whether a chunk is worth
 * showing at all.
 *
 * `lexicalOverlap` splits on anything that is not a letter or digit, which for
 * Thai includes its tone marks and vowel signs: a query breaks into fragments
 * that match by accident as often as by meaning, and never at all when the
 * wording differs slightly. Trigram word similarity measures the same lexical
 * closeness without needing word boundaries. Taking the stronger of the two
 * keeps the existing weights untouched — where words are actually separated,
 * overlap still wins.
 */
export function scoreRetrievedChunk(
  query: string,
  content: string,
  row: { vectorScore: number; keywordScore: number; trigramScore?: number },
) {
  const trigramScore = Math.max(
    0,
    Math.min(1, Number(row.trigramScore ?? 0) || 0),
  );
  const lexical = Math.max(lexicalOverlap(query, content), trigramScore);
  const keywordScore = Math.max(0, Number(row.keywordScore) || 0);
  const score =
    Math.max(0, Number(row.vectorScore) || 0) * 0.65 +
    keywordScore * 0.15 +
    lexical * 0.2;
  return {
    trigramScore,
    score,
    // The trigram clause is what keeps a Thai question answerable while the
    // embedding provider is down: on its own the blended score of a chunk that
    // only matched on trigrams lands under the 0.08 floor.
    admitted: score > 0.08 || keywordScore > 0 || trigramScore >= TRIGRAM_FLOOR,
  };
}

export async function retrieveBotContext(
  context: AuthorizationContext,
  botId: string,
  query: string,
  options?: {
    reranker?: KnowledgeReranker;
    allAccessible?: boolean;
    sourceIds?: string[];
    documentIds?: string[];
  },
) {
  await requireBotUse(context, botId);
  const bot = await db.bot.findFirst({
    where: { id: botId, organizationId: context.organizationId },
    include: { providerConfig: true },
  });
  if (!bot) return [];
  const rackAssignments =
    options?.allAccessible ||
    options?.sourceIds?.length ||
    options?.documentIds?.length
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
  } catch (error) {
    // Keyword retrieval remains available during an embedding-provider outage,
    // but it is markedly worse, so the drop must not be silent: without this the
    // only symptom is answers quietly getting thinner.
    logger.warn("Retrieval fell back to keyword search", {
      organizationId: context.organizationId,
      botId,
      errorType: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message.slice(0, 200) : undefined,
    });
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
      AND (
        (cardinality($8::text[]) = 0 AND cardinality($9::text[]) = 0)
        OR s.id = ANY($8::text[])
        OR d.id = ANY($9::text[])
      )`;
  const keywordAclSql = vectorAclSql
    .replaceAll("$7", "$5")
    .replaceAll("$8", "$6")
    .replaceAll("$9", "$7");
  // `to_tsvector('simple', ...)` splits on whitespace, and Thai is written
  // without it, so a Thai sentence becomes one token that matches nothing:
  // measured on the indexed corpus, every Thai query scored zero on the keyword
  // path while Latin ones scored normally. Trigram word similarity gives the
  // lexical signal a form that works for both, which matters most when the
  // embedding provider is down and this is the only signal left. It scans every
  // row, like `ts_rank_cd` above it already does, so it adds no new cliff.
  //
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
                ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', $6)) AS "keywordScore",
                word_similarity($6, c.content) AS "trigramScore"
         ${vectorAclSql}
         ORDER BY (CASE WHEN c."embeddingDimension" = $5
                        THEN 1 - (${vectorDistance}) ELSE 0 END) DESC,
                  "keywordScore" DESC, "trigramScore" DESC
         LIMIT 40`,
        botId,
        context.organizationId,
        authorizedRackIds,
        `[${vector.join(",")}]`,
        vector.length,
        query,
        Boolean(options?.allAccessible),
        options?.sourceIds ?? [],
        options?.documentIds ?? [],
      )
    : await db.$queryRawUnsafe<RetrievalRow[]>(
        `SELECT c.id AS "chunkId", c.content, c."contentHash", c.metadata,
                d.id AS "documentId", d.name AS "documentName", d."mimeType",
                s.id AS "sourceId",
                0::float AS "vectorScore",
                ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', $4)) AS "keywordScore",
                word_similarity($4, c.content) AS "trigramScore"
         ${keywordAclSql}
         ORDER BY GREATEST(
                    ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', $4)),
                    word_similarity($4, c.content)
                  ) DESC, c."createdAt" DESC
         LIMIT 80`,
        botId,
        context.organizationId,
        authorizedRackIds,
        query,
        Boolean(options?.allAccessible),
        options?.sourceIds ?? [],
        options?.documentIds ?? [],
      );
  const seen = new Set<string>();
  const candidates = rows
    .map((row) => {
      const content = sanitizeRetrievedContent(row.content);
      return { ...row, content, ...scoreRetrievedChunk(query, content, row) };
    })
    .filter((row) => {
      if (!row.content || seen.has(row.contentHash)) return false;
      seen.add(row.contentHash);
      return row.admitted;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
  const ranked = options?.reranker
    ? await options.reranker.rerank({ query, candidates })
    : candidates;
  return ranked.slice(0, 6);
}
