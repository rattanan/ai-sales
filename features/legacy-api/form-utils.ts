import { sourceAssignmentSchema } from "@/schemas/knowledge";

export function pendingLegacyApiSourceId(value: FormDataEntryValue | null) {
  const sourceId = typeof value === "string" ? value.trim() : "";
  return sourceId || "pending";
}

export function parseLegacyApiSourceAssignment(formData: FormData) {
  return sourceAssignmentSchema.safeParse({
    sourceType: "API_TOOL",
    sourceId: pendingLegacyApiSourceId(formData.get("legacyApiId")),
    scope: formData.get("sourceScope"),
    botIds: formData.getAll("botIds"),
    enabled: formData.get("enabled"),
    priority: formData.get("priority"),
  });
}
