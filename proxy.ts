import { auth } from "@/auth";
import { isTrustedMutationRequest } from "@/server/http/request-security";

export const proxy = auth((request) => {
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/api/auth/") &&
    !isTrustedMutationRequest(request)
  )
    return Response.json(
      { error: "CSRF_REJECTED", message: "Cross-origin mutation denied." },
      { status: 403 },
    );
});

export const config = {
  matcher: [
    "/workspace/:path*",
    "/onboarding/:path*",
    "/change-password",
    "/api/:path*",
  ],
};
