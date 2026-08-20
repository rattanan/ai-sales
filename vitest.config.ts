import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(process.cwd()) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: { reporter: ["text", "html"] },
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://test:test@127.0.0.1:5432/test",
      AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
      CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      AI_MODEL: "mock-analysis-model",
      AI_BASE_URL: "http://mock-ai.test/v1",
    },
  },
});
