import { embeddedSessionRequestSchema } from "@/schemas/authentication";
import {
  EmbeddedAuthenticationError,
  exchangeEmbeddedSession,
  recordEmbeddedAuthenticationFailure,
} from "@/server/auth/embedded-auth";

export async function POST(request: Request) {
  const parsed = embeddedSessionRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      {
        error: "VALIDATION_ERROR",
        message: "The signed identity envelope is invalid.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  try {
    const session = await exchangeEmbeddedSession(parsed.data);
    return Response.json(session, {
      headers: { "cache-control": "no-store", pragma: "no-cache" },
    });
  } catch (error) {
    const code =
      error instanceof EmbeddedAuthenticationError
        ? error.code
        : "CONFIGURATION_ERROR";
    await recordEmbeddedAuthenticationFailure(
      parsed.data.botId,
      parsed.data.hostOrigin,
      code,
    ).catch(() => undefined);
    const status =
      code === "CONFIGURATION_ERROR"
        ? 503
        : code === "SESSION_FIXATION"
          ? 409
          : 401;
    return Response.json(
      { error: code, message: "Embedded authentication was denied." },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
