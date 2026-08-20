import { apiFailure, apiSuccess } from "../../../../server/http/api-response";
import { getPlatformHealth } from "../../../../server/services/platform-health";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const health = await getPlatformHealth();
    return apiSuccess(request, health, {
      status: health.status === "ok" ? 200 : 503,
    });
  } catch {
    return apiFailure(
      request,
      {
        code: "INTERNAL_ERROR",
        message: "Platform health is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
}
