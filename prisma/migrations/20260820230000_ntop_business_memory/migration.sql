CREATE TYPE "NtopActionType" AS ENUM ('CREATE_PROSPECT', 'CREATE_LEAD', 'CREATE_OPPORTUNITY', 'UPDATE_OPPORTUNITY', 'CREATE_QUOTATION');
CREATE TYPE "NtopActionStatus" AS ENUM ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "NtopActionProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "NtopActionType" NOT NULL,
    "status" "NtopActionStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NtopActionProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NtopActionProposal_idempotencyKey_key" ON "NtopActionProposal"("idempotencyKey");
CREATE INDEX "NtopActionProposal_organizationId_userId_status_createdAt_idx" ON "NtopActionProposal"("organizationId", "userId", "status", "createdAt");
CREATE INDEX "NtopActionProposal_conversationId_createdAt_idx" ON "NtopActionProposal"("conversationId", "createdAt");
CREATE INDEX "NtopActionProposal_messageId_idx" ON "NtopActionProposal"("messageId");
ALTER TABLE "NtopActionProposal" ADD CONSTRAINT "NtopActionProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NtopActionProposal" ADD CONSTRAINT "NtopActionProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NtopActionProposal" ADD CONSTRAINT "NtopActionProposal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NtopActionProposal" ADD CONSTRAINT "NtopActionProposal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
