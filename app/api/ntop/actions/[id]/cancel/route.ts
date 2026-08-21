import { getAuthorizationContext } from "@/server/auth/authorization";
import { cancelNtopAction } from "@/server/services/ntop-action-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAuthorizationContext();
  if (!context)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const result = await cancelNtopAction(context, (await params).id);
  if (!result.ok)
    return Response.json(
      { error: result.error.code, message: result.error.message },
      { status: 409 },
    );
  return Response.json({ data: result.data });
}
