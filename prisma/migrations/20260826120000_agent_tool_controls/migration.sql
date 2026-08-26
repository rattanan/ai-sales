-- Per-bot control over which agent tools may be used, and how hard the model
-- is asked to think. All additive: existing rows keep working unchanged.

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "disabledTools" TEXT[];

-- AlterTable
ALTER TABLE "BotProviderConfig" ADD COLUMN     "reasoningEffort" TEXT;

-- AlterTable
ALTER TABLE "AiEndpointConfig" ADD COLUMN     "supportsReasoningEffort" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "reasoningEffort" TEXT,
ADD COLUMN     "reasoningChars" INTEGER;
