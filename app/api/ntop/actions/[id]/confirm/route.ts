import { getAuthorizationContext } from "@/server/auth/authorization";
import { confirmNtopAction } from "@/server/services/ntop-action-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAuthorizationContext();
  if (!context)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const result = await confirmNtopAction(context, (await params).id);
  if (!result.ok)
    return Response.json(
      { error: result.error.code, message: result.error.message },
      {
        status:
          result.error.code === "NOT_FOUND"
            ? 404
            : result.error.code === "CONNECTION_FAILED"
              ? 502
              : 409,
      },
    );
  return Response.json({
    data: {
      id: result.data.id,
      status: result.data.status,
      result: result.data.result,
      errorMessage: result.data.errorMessage,
    },
  });
}
