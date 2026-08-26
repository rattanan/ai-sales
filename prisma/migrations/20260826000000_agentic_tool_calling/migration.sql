-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "agenticEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxToolSteps" INTEGER NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "BotProviderConfig" ADD COLUMN     "toolMode" TEXT NOT NULL DEFAULT 'SEPARATE';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "toolStepCount" INTEGER;

-- AlterTable
ALTER TABLE "ToolExecutionTrace" ADD COLUMN     "stepIndex" INTEGER,
ADD COLUMN     "toolCallId" TEXT;

-- AlterTable
ALTER TABLE "AiEndpointConfig" ADD COLUMN     "supportsToolCalling" BOOLEAN NOT NULL DEFAULT false;

