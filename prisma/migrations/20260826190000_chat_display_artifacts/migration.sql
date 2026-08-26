-- CreateTable
CREATE TABLE "ChatMessageArtifact" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "mediaBytes" BYTEA,
    "mediaType" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessageArtifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChatMessageArtifact_kind_check" CHECK ("kind" IN ('qr', 'chart', 'image')),
    CONSTRAINT "ChatMessageArtifact_storage_check" CHECK (
        (
            "kind" = 'image'
            AND "mediaBytes" IS NOT NULL
            AND octet_length("mediaBytes") BETWEEN 1 AND 1048576
            AND "mediaType" IN ('image/jpeg', 'image/png', 'image/webp')
        )
        OR (
            "kind" IN ('qr', 'chart')
            AND "mediaBytes" IS NULL
            AND "mediaType" IS NULL
        )
    )
);

-- New display tools are intentionally opt-in for existing bots. The tool
-- settings UI can remove these names when an administrator enables them.
UPDATE "Bot"
SET "disabledTools" = ARRAY(
    SELECT DISTINCT value
    FROM unnest("disabledTools" || ARRAY['display_qr', 'display_chart', 'display_image']) AS value
);

ALTER TABLE "Bot"
ALTER COLUMN "disabledTools"
SET DEFAULT ARRAY['display_qr', 'display_chart', 'display_image']::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageArtifact_messageId_position_key" ON "ChatMessageArtifact"("messageId", "position");

-- AddForeignKey
ALTER TABLE "ChatMessageArtifact" ADD CONSTRAINT "ChatMessageArtifact_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
