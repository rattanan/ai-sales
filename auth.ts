import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/server/db";
import { loginSchema } from "@/schemas/auth";
import { authenticateCredentials } from "@/server/services/login-security";

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost:
    process.env.NODE_ENV !== "production" ||
    process.env.AUTH_TRUST_HOST === "true",
  // Production images are also used for the local HTTP Compose drill. Secure
  // cookies follow the externally advertised URL so that the drill remains
  // usable while HTTPS deployments still receive secure-only cookies.
  useSecureCookies: (process.env.APP_URL ?? "").startsWith("https://"),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        identifier: {},
        password: {},
        rememberMe: {},
        organization: {},
      },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const authenticated = await authenticateCredentials(
          parsed.data.identifier,
          parsed.data.password,
          request,
          parsed.data.organization,
        );
        if (!authenticated) return null;
        const { user, loginHistoryId } = authenticated;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          sessionVersion: user.sessionVersion,
          mustChangePassword: user.mustChangePassword,
          rememberMe: parsed.data.rememberMe,
          loginHistoryId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        const loginUser = user as typeof user & {
          sessionVersion: number;
          mustChangePassword: boolean;
          rememberMe: boolean;
          loginHistoryId: string;
        };
        token.userId = user.id;
        token.sessionVersion = loginUser.sessionVersion;
        token.mustChangePassword = loginUser.mustChangePassword;
        token.loginHistoryId = loginUser.loginHistoryId;
        token.exp =
          Math.floor(Date.now() / 1000) +
          (loginUser.rememberMe ? 30 * 86400 : 8 * 3600);
      } else if (token.userId) {
        const current = await db.user.findUnique({
          where: { id: String(token.userId) },
          select: {
            status: true,
            deletedAt: true,
            sessionVersion: true,
            mustChangePassword: true,
            lockedUntil: true,
          },
        });
        token.invalid =
          !current ||
          current.deletedAt !== null ||
          current.status === "DISABLED" ||
          current.status === "LOCKED" ||
          current.sessionVersion !== token.sessionVersion;
        token.mustChangePassword = current?.mustChangePassword ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.invalid
          ? ""
          : String(token.userId ?? token.sub);
        session.user.mustChangePassword = Boolean(token.mustChangePassword);
        session.user.loginHistoryId = token.loginHistoryId
          ? String(token.loginHistoryId)
          : undefined;
      }
      return session;
    },
    authorized({ auth: session, request }) {
      const isWorkspace = request.nextUrl.pathname.startsWith("/workspace");
      const isPasswordChange = request.nextUrl.pathname === "/change-password";
      if ((isWorkspace || isPasswordChange) && !session?.user?.id) return false;
      if (isWorkspace && session?.user.mustChangePassword)
        return Response.redirect(new URL("/change-password", request.nextUrl));
      return true;
    },
  },
});
