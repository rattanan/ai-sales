import { z } from "zod";

const environmentBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value;
}, z.boolean());

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: z.string().refine((value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  }, "Must be a base64-encoded 32-byte key"),
  DATA_SOURCE_ENCRYPTION_KEY: z
    .string()
    .refine((value) => {
      try {
        return Buffer.from(value, "base64").length === 32;
      } catch {
        return false;
      }
    }, "Must be a base64-encoded 32-byte key")
    .optional(),
  CREDENTIAL_KEY_VERSION: z.string().default("env-v1"),
  CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: z.string().default(""),
  APP_URL: z.string().url().default("http://localhost:3000"),
  OBJECT_STORAGE_DRIVER: z.enum(["local", "gcs"]).default("local"),
  LOCAL_STORAGE_PATH: z.string().default(".data/uploads"),
  REDIS_URL: z
    .string()
    .url()
    .refine(
      (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
      "Must use the redis or rediss protocol",
    )
    .default("redis://127.0.0.1:6379/0"),
  MAX_EXCEL_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10_485_760),
  MAX_EXCEL_IMPORT_ROWS: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(100_000),
  MAX_EXCEL_SHEETS: z.coerce.number().int().min(1).max(200).default(50),
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
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(16),
  EMBEDDING_BATCH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  AI_PROVIDER: z.enum(["openai-compatible"]).default("openai-compatible"),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).optional(),
  AI_SUPPORTS_JSON_SCHEMA: environmentBoolean.default(true),
  AI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(180_000),
  AI_STREAM_INACTIVITY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(180_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_CIRCUIT_FAILURE_THRESHOLD: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3),
  AI_CIRCUIT_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(900_000)
    .default(30_000),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  AI_MAX_TABLES: z.coerce.number().int().min(1).max(100).default(30),
  AI_MAX_COLUMNS_PER_TABLE: z.coerce.number().int().min(1).max(500).default(80),
  AI_SAMPLE_ROWS_PER_TABLE: z.coerce.number().int().min(0).max(20).default(5),
  AI_MAX_SAMPLE_CELL_LENGTH: z.coerce
    .number()
    .int()
    .min(20)
    .max(2_000)
    .default(200),
  AI_MAX_CONTEXT_CHARACTERS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(500_000)
    .default(120_000),
  AI_SEND_SAMPLE_DATA: environmentBoolean.default(true),
  AI_MASK_SENSITIVE_DATA: environmentBoolean.default(true),
  AI_MAX_KPI_RECOMMENDATIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(12),
  AI_MAX_WIDGETS: z.coerce.number().int().min(1).max(50).default(12),
  AI_MAX_INSIGHTS: z.coerce.number().int().min(0).max(50).default(8),
  QUERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(60_000)
    .default(10_000),
  QUERY_MAX_ROWS: z.coerce.number().int().min(1).max(10_000).default(1_000),
  QUERY_PREVIEW_ROWS: z.coerce.number().int().min(1).max(1_000).default(100),
  QUEUE_MAX_WAITING_JOBS: z.coerce
    .number()
    .int()
    .min(10)
    .max(1_000_000)
    .default(5_000),
  SLO_AVAILABILITY_TARGET_PERCENT: z.coerce
    .number()
    .min(90)
    .max(100)
    .default(99.5),
  SLO_CHAT_P95_TARGET_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(15_000),
  SLO_INDEX_P95_TARGET_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_440)
    .default(30),
  SLO_ERROR_RATE_TARGET_PERCENT: z.coerce.number().min(0).max(100).default(2),
  SLOW_QUERY_THRESHOLD_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(1_000),
  INITIAL_ADMIN_NAME: z.string().min(2).optional(),
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_USERNAME: z.string().min(3).max(64).optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(12).optional(),
  PASSWORD_RESET_TOKEN_EXPIRY_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(1440)
    .default(30),
  PASSWORD_RESET_DELIVERY_URL: z.string().url().optional(),
  PASSWORD_RESET_DELIVERY_TOKEN: z.string().min(16).optional(),
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  ACCOUNT_LOCK_DURATION_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(30),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(60)
    .default(15),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(5)
    .max(100)
    .default(20),
  SEED_DEVELOPMENT_TEST_USERS: environmentBoolean.default(false),
  DEVELOPMENT_TEST_USER_PASSWORD: z.string().min(12).optional(),
});

export type AppEnvironment = z.infer<typeof envSchema>;

let cached: AppEnvironment | undefined;
export function env(): AppEnvironment {
  cached ??= envSchema.parse(process.env);
  return cached;
}
