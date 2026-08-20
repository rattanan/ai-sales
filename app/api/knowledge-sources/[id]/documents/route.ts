import { getAuthorizationContext } from "@/server/auth/authorization";
import { contentLengthWithinLimit } from "@/server/http/request-security";
import { env } from "@/schemas/env";
import { uploadKnowledgeSourceDocument } from "@/server/services/knowledge-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAuthorizationContext();
  if (!context)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (
    !contentLengthWithinLimit(
      request,
      env().KNOWLEDGE_MAX_UPLOAD_BYTES + 64 * 1_024,
    )
  )
    return Response.json(
      { error: "FILE_TOO_LARGE", message: "Upload exceeds the size limit." },
      { status: 413 },
    );

  const { id } = await params;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File))
    return Response.json(
      { error: "VALIDATION_ERROR", message: "Choose a file to upload." },
      { status: 400 },
    );
  const result = await uploadKnowledgeSourceDocument(context, id, file);
  if (!result.ok)
    return Response.json(
      { error: result.error.code, message: result.error.message },
      {
        status:
          result.error.code === "NOT_FOUND"
            ? 404
            : result.error.code === "FORBIDDEN"
              ? 403
              : result.error.code === "INTERNAL_ERROR"
                ? 503
                : 400,
      },
    );
  return Response.json(result.data, {
    status: result.data.duplicate ? 200 : 202,
  });
}
