import "dotenv/config";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";

async function bootstrap() {
  const application = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log", "debug"],
  });
  application.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger("WorkerBootstrap");
  logger.error(
    "InsightKM worker failed to start",
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
