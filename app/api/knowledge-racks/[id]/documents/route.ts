import { getAuthorizationContext } from "@/server/auth/authorization";
import { uploadKnowledgeDocument } from "@/server/services/knowledge-service";
import { env } from "@/schemas/env";
import { contentLengthWithinLimit } from "@/server/http/request-security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAuthorizationContext();
  if (!context)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { id } = await params;
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
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File))
      return Response.json(
        { error: "VALIDATION_ERROR", message: "Choose a file to upload." },
        { status: 400 },
      );
    const result = await uploadKnowledgeDocument(context, id, file);
    if (!result.ok)
      return Response.json(
        { error: result.error.code, message: result.error.message },
        {
          status:
            result.error.code === "NOT_FOUND"
              ? 404
              : result.error.code === "FORBIDDEN"
                ? 403
                : 400,
        },
      );
    return Response.json(result.data, {
      status: result.data.duplicate ? 200 : 202,
    });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "NOT_FOUND";
    return Response.json(
      {
        error: forbidden ? "NOT_FOUND" : "INTERNAL_ERROR",
        message: forbidden
          ? "Knowledge rack not found."
          : "Document upload failed.",
      },
      { status: forbidden ? 404 : 500 },
    );
  }
}
