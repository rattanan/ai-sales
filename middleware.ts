import { auth } from "@/auth";
import { isTrustedMutationRequest } from "@/server/http/request-security";

// Next.js 16.3 currently omits proxy.ts from the production middleware
// manifest in some standalone builds. Keep the legacy filename/export until
// upstream restores equivalent proxy.ts production behavior.
export const middleware = auth((request) => {
  const isWorkspace = request.nextUrl.pathname.startsWith("/workspace");
  const isOnboarding = request.nextUrl.pathname.startsWith("/onboarding");
  const isPasswordChange = request.nextUrl.pathname === "/change-password";

  if (
    (isWorkspace || isOnboarding || isPasswordChange) &&
    !request.auth?.user?.id
  )
    return Response.redirect(new URL("/login", request.nextUrl));

  if (isWorkspace && request.auth?.user.mustChangePassword)
    return Response.redirect(new URL("/change-password", request.nextUrl));

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

export const runtime = "nodejs";
