import type { Prisma } from "@/generated/prisma/client";
import {
  storedChartArtifactPayloadSchema,
  storedImageArtifactPayloadSchema,
  storedQrArtifactPayloadSchema,
} from "@/schemas/chat-artifact";
import type { GeneratedChatArtifact } from "@/server/ai/agent/types";
import type { ChatArtifact } from "@/types/chat-artifact";

type PersistedArtifact = {
  id: string;
  kind: string;
  payload: unknown;
  mediaBytes?: Uint8Array | null;
  mediaType?: string | null;
};

function ownedBytes(value: Uint8Array) {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return bytes;
}

export function artifactCreateRows(
  artifacts: GeneratedChatArtifact[],
): Prisma.ChatMessageArtifactCreateWithoutMessageInput[] {
  return artifacts.map((artifact, position) => {
    if (artifact.kind === "image")
      return {
        id: artifact.id,
        kind: artifact.kind,
        payload: {
          alt: artifact.alt,
          ...(artifact.caption ? { caption: artifact.caption } : {}),
        },
        mediaBytes: ownedBytes(artifact.mediaBytes),
        mediaType: artifact.mediaType,
        position,
      };
    if (artifact.kind === "qr")
      return {
        id: artifact.id,
        kind: artifact.kind,
        payload: {
          svg: artifact.svg,
          ...(artifact.label ? { label: artifact.label } : {}),
          ...(artifact.caption ? { caption: artifact.caption } : {}),
        },
        position,
      };
    return {
      id: artifact.id,
      kind: artifact.kind,
      payload: {
        svg: artifact.svg,
        type: artifact.type,
        labels: artifact.labels,
        datasets: artifact.datasets,
        ...(artifact.title ? { title: artifact.title } : {}),
        ...(artifact.horizontal !== undefined
          ? { horizontal: artifact.horizontal }
          : {}),
        ...(artifact.stacked !== undefined
          ? { stacked: artifact.stacked }
          : {}),
        ...(artifact.valueSuffix ? { valueSuffix: artifact.valueSuffix } : {}),
      } as Prisma.InputJsonValue,
      position,
    };
  });
}

/** Used only between tool execution and final persistence. */
export function liveChatArtifact(
  artifact: GeneratedChatArtifact,
): ChatArtifact {
  if (artifact.kind !== "image") return artifact;
  return {
    id: artifact.id,
    kind: artifact.kind,
    src: `data:${artifact.mediaType};base64,${Buffer.from(artifact.mediaBytes).toString("base64")}`,
    mediaType: artifact.mediaType,
    alt: artifact.alt,
    caption: artifact.caption,
  };
}

/**
 * Validates JSON read from storage before it crosses into a Client Component.
 * A corrupt or future kind is ignored instead of breaking the conversation.
 */
export function storedChatArtifact(
  row: PersistedArtifact,
): ChatArtifact | null {
  if (row.kind === "qr") {
    const payload = storedQrArtifactPayloadSchema.safeParse(row.payload);
    return payload.success ? { id: row.id, kind: "qr", ...payload.data } : null;
  }
  if (row.kind === "chart") {
    const payload = storedChartArtifactPayloadSchema.safeParse(row.payload);
    return payload.success
      ? { id: row.id, kind: "chart", ...payload.data }
      : null;
  }
  if (row.kind === "image") {
    const payload = storedImageArtifactPayloadSchema.safeParse(row.payload);
    const mediaType = row.mediaType;
    if (
      !payload.success ||
      !row.mediaBytes?.length ||
      !["image/jpeg", "image/png", "image/webp"].includes(mediaType ?? "")
    )
      return null;
    return {
      id: row.id,
      kind: "image",
      src: `/api/chat-artifacts/${encodeURIComponent(row.id)}`,
      mediaType: mediaType as "image/jpeg" | "image/png" | "image/webp",
      ...payload.data,
    };
  }
  return null;
}

export function storedChatArtifacts(rows: PersistedArtifact[]) {
  return rows
    .map(storedChatArtifact)
    .filter((artifact): artifact is ChatArtifact => artifact !== null);
}
