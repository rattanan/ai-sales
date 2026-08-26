-- CreateTable
CREATE TABLE "MessageReasoningStep" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReasoningStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageReasoningStep_messageId_stepIndex_key" ON "MessageReasoningStep"("messageId", "stepIndex");

-- AddForeignKey
ALTER TABLE "MessageReasoningStep" ADD CONSTRAINT "MessageReasoningStep_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
