"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import {
  legacyApiIdSchema,
  legacyApiInvocationInputSchema,
  legacyApiRegistrySchema,
} from "@/schemas/legacy-api";
import {
  deleteLegacyApi,
  generateLegacyApiToolDefinition,
  saveLegacyApi,
  testLegacyApi,
  testLegacyApiDraft,
} from "@/server/services/legacy-api-service";
import { failure } from "@/types/result";
import { updateSourceAssignment } from "@/server/services/unified-source-service";
import { parseLegacyApiSourceAssignment } from "./form-utils";

function json(value: FormDataEntryValue | null, fallback: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true as const, value: fallback };
  try {
    return { ok: true as const, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false as const };
  }
}

function inferredAllowedDomains(baseUrl: FormDataEntryValue | null) {
  try {
    return [new URL(String(baseUrl ?? "")).hostname.toLowerCase()];
  } catch {
    return [];
  }
}

function parseRegistryFormData(formData: FormData) {
  const parsedJson = {
    requestHeaders: json(formData.get("requestHeadersJson"), {}),
    parameters: json(formData.get("parametersJson"), []),
    bodyTemplate: json(formData.get("bodyTemplateJson"), null),
    responseSchema: json(formData.get("responseSchemaJson"), {}),
    responseMapping: json(formData.get("responseMappingJson"), {}),
  };
  if (Object.values(parsedJson).some((item) => !item.ok))
    return failure(
      "VALIDATION_ERROR",
      "Headers, parameters, templates, schema, and mapping must contain valid JSON.",
    );
  const parsed = legacyApiRegistrySchema.safeParse({
    ...Object.fromEntries(formData),
    allowedDomains: inferredAllowedDomains(formData.get("baseUrl")),
    requestHeaders: parsedJson.requestHeaders.value,
    parameters: parsedJson.parameters.value,
    bodyTemplate: parsedJson.bodyTemplate.value,
    responseSchema: parsedJson.responseSchema.value,
    responseMapping: parsedJson.responseMapping.value,
  });
  return parsed.success
    ? { ok: true as const, data: parsed.data }
    : failure("VALIDATION_ERROR", "Check the API tool fields.", {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
}

export async function saveLegacyApiAction(_state: unknown, formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "legacy_api.manage");
  const parsed = parseRegistryFormData(formData);
  if (!parsed.ok) return parsed;
  const assignment = parseLegacyApiSourceAssignment(formData);
  if (!assignment.success) {
    const fieldErrors = assignment.error.flatten().fieldErrors;
    const message =
      fieldErrors.botIds?.[0] ??
      fieldErrors.scope?.[0] ??
      fieldErrors.priority?.[0] ??
      fieldErrors.sourceId?.[0] ??
      "Check the API scope and bot assignments.";
    return failure("VALIDATION_ERROR", message, {
      fieldErrors,
    });
  }
  await requirePermission(context, "bot.manage");
  const testParameters = json(formData.get("testParametersJson"), {});
  if (
    !testParameters.ok ||
    !testParameters.value ||
    Array.isArray(testParameters.value)
  )
    return failure("VALIDATION_ERROR", "Provide valid test input values.");
  const result = await saveLegacyApi(context, parsed.data);
  if (result.ok) {
    const assigned = await updateSourceAssignment(context, {
      ...assignment.data,
      sourceId: result.data.id,
    });
    if (!assigned.ok) return assigned;
    const verified = await testLegacyApi(
      context,
      result.data.id,
      testParameters.value as Record<string, string | number | boolean>,
    );
    if (!verified.ok) return verified;
    revalidatePath("/workspace/sources/api-tools");
    revalidatePath("/workspace/admin/bots");
    revalidatePath("/workspace/sources");
  }
  return result;
}

export async function testLegacyApiDraftAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "legacy_api.manage");
  const parsed = parseRegistryFormData(formData);
  const parameters = json(formData.get("testParametersJson"), {});
  if (!parsed.ok) return parsed;
  if (!parameters.ok || !parameters.value || Array.isArray(parameters.value))
    return failure("VALIDATION_ERROR", "Provide valid test input values.");
  return testLegacyApiDraft(
    context,
    parsed.data,
    parameters.value as Record<string, string | number | boolean>,
  );
}

export async function testLegacyApiAction(_state: unknown, formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "legacy_api.manage");
  const parsed = legacyApiIdSchema.safeParse({ id: formData.get("id") });
  const parameters = json(formData.get("parametersJson"), {});
  if (!parsed.success || !parameters.ok)
    return failure("VALIDATION_ERROR", "Provide valid JSON test parameters.");
  const invocation = legacyApiInvocationInputSchema.safeParse({
    legacyApiId: parsed.success ? parsed.data.id : "",
    question: "Administrator connection test",
    parameters: parameters.value,
  });
  if (!invocation.success)
    return failure(
      "VALIDATION_ERROR",
      "Test parameters must be a JSON object.",
    );
  return testLegacyApi(
    context,
    invocation.data.legacyApiId,
    invocation.data.parameters,
  );
}

export async function generateLegacyApiToolDefinitionAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "legacy_api.manage");
  const parsed = legacyApiIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "API tool is required.");
  return generateLegacyApiToolDefinition(context, parsed.data.id);
}

export async function deleteLegacyApiAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "legacy_api.manage");
  const parsed = legacyApiIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Legacy API is required.");
  const result = await deleteLegacyApi(context, parsed.data.id);
  if (result.ok) {
    revalidatePath("/workspace/sources/api-tools");
    revalidatePath("/workspace/admin/bots");
    redirect("/workspace/sources/api-tools");
  }
  return result;
}
