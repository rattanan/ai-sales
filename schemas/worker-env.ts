import { z } from "zod";

const redisUrl = z
  .string()
  .url()
  .refine(
    (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
    "Must use the redis or rediss protocol",
  );

export const workerEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().refine((value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  }),
  CREDENTIAL_KEY_VERSION: z.string().default("env-v1"),
  CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: z.string().default(""),
  LOCAL_STORAGE_PATH: z.string().default(".data/uploads"),
  KNOWLEDGE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(26_214_400),
  KNOWLEDGE_CHUNK_CHARACTERS: z.coerce
    .number()
    .int()
    .min(400)
    .max(8_000)
    .default(1_200),
  KNOWLEDGE_CHUNK_OVERLAP: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000)
    .default(200),
  KNOWLEDGE_CHUNK_MAX_TOKENS: z.coerce
    .number()
    .int()
    .min(64)
    .max(8_192)
    .default(400),
  KNOWLEDGE_SHARED_FOLDER_ROOTS: z.string().min(1).default(".data/shared"),
  KNOWLEDGE_SHARED_FOLDER_MAX_FILES: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(10_000),
  GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  KNOWLEDGE_WEB_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(26_214_400)
    .default(5_242_880),
  KNOWLEDGE_WEB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(15_000),
  KNOWLEDGE_WEB_MAX_REDIRECTS: z.coerce.number().int().min(0).max(5).default(3),
  EMBEDDING_BASE_URL: z
    .string()
    .url()
    .default("https://ollama.rattanan.dev/api/embed"),
  EMBEDDING_MODEL: z.string().min(1).default("qwen3-embedding:4b"),
  EMBEDDING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(120_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(16),
  EMBEDDING_BATCH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  REDIS_URL: redisUrl.default("redis://127.0.0.1:6379/0"),
  BULLMQ_PREFIX: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9:_-]+$/)
    .default("insightkm"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  WORKER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(50),
  WORKER_RATE_LIMIT_DURATION_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(1_000),
  QUEUE_MAX_WAITING_JOBS: z.coerce
    .number()
    .int()
    .min(10)
    .max(1_000_000)
    .default(5_000),
  WORKER_HEALTH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),
});

export type WorkerEnvironment = z.infer<typeof workerEnvSchema>;

let cached: WorkerEnvironment | undefined;

export function workerEnv(
  input: Record<string, string | undefined> = process.env,
): WorkerEnvironment {
  if (input !== process.env) return workerEnvSchema.parse(input);
  cached ??= workerEnvSchema.parse(process.env);
  return cached;
}
