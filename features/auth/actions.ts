"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth, signIn, signOut } from "@/auth";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/schemas/auth";
import { db } from "@/server/db";
import {
  changeTemporaryPassword,
  consumePasswordReset,
  createPasswordReset,
} from "@/server/services/password-reset";
import { consumeRateLimit } from "@/server/services/rate-limit";
import { env } from "@/schemas/env";
import { deliverPasswordReset } from "@/server/services/password-reset-delivery";
import type { AppResult } from "@/types/result";
import { failure, success } from "@/types/result";

export async function registerAction(
  _previous: AppResult<{ registered: true }> | null,
  formData: FormData,
) {
  void formData;
  return failure(
    "FORBIDDEN",
    "Public registration is disabled. Contact your system administrator.",
  );
}

export async function loginAction(
  _previous: AppResult<{ authenticated: true }> | null,
  formData: FormData,
) {
  try {
    await signIn("credentials", {
      identifier: String(formData.get("identifier") ?? ""),
      password: String(formData.get("password") ?? ""),
      rememberMe: formData.get("rememberMe") === "on",
      organization: String(formData.get("organization") ?? ""),
      redirect: false,
    });
    const session = await auth();
    redirect(
      session?.user?.mustChangePassword ? "/change-password" : "/workspace",
    );
  } catch (error) {
    if (error instanceof AuthError)
      return failure(
        "UNAUTHENTICATED",
        "Sign-in failed. Check your credentials or contact an administrator.",
      );
    throw error;
  }
}

export async function logoutAction() {
  const session = await auth();
  if (session?.user?.loginHistoryId) {
    await db.loginHistory.updateMany({
      where: { id: session.user.loginHistoryId, userId: session.user.id },
      data: { logoutAt: new Date() },
    });
  }
  if (session?.user?.id) {
    const membership = await db.organizationMember.findFirst({
      where: { userId: session.user.id },
    });
    if (membership)
      await db.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          actorId: session.user.id,
          action: "LOGOUT",
          entityType: "User",
          entityId: session.user.id,
        },
      });
  }
  await signOut({ redirectTo: "/" });
}

export async function logoutAllSessionsAction() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
  });
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: session.user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    await tx.session.deleteMany({ where: { userId: session.user.id } });
    if (membership)
      await tx.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          actorId: session.user.id,
          action: "LOGOUT_ALL_SESSIONS",
          entityType: "User",
          entityId: session.user.id,
        },
      });
  });
  await signOut({ redirectTo: "/login?sessionsRevoked=1" });
}

export async function updateProfileAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 100) return;
  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
  });
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.user.id }, data: { name } });
    if (membership)
      await tx.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          actorId: session.user.id,
          action: "PROFILE_UPDATED",
          entityType: "User",
          entityId: session.user.id,
          afterValue: { name },
        },
      });
  });
  revalidatePath("/workspace/profile");
}

export async function forgotPasswordAction(
  _previous: AppResult<{
    submitted: true;
    developmentResetUrl?: string;
  }> | null,
  formData: FormData,
) {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Enter a valid email address.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const requestHeaders = await headers();
  const requestIp =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip");
  const recoveryLimits = await Promise.all(
    [...new Set([parsed.data.email, requestIp].filter(Boolean))].map((key) =>
      consumeRateLimit(
        "forgot-password",
        String(key),
        Math.min(10, env().LOGIN_RATE_LIMIT_MAX_ATTEMPTS),
        env().LOGIN_RATE_LIMIT_WINDOW_MINUTES,
      ),
    ),
  );
  if (recoveryLimits.some((allowed) => !allowed))
    return success<{ submitted: true; developmentResetUrl?: string }>({
      submitted: true,
    });
  const reset = await createPasswordReset(parsed.data.email);
  if (reset.userId) await deliverPasswordReset(parsed.data.email, reset.token);
  return success<{ submitted: true; developmentResetUrl?: string }>({
    submitted: true,
    ...(process.env.NODE_ENV === "development"
      ? { developmentResetUrl: `/reset-password?token=${reset.token}` }
      : {}),
  });
}

export async function resetPasswordAction(
  _previous: AppResult<{ reset: true }> | null,
  formData: FormData,
) {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the password requirements.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  if (!(await consumePasswordReset(parsed.data.token, parsed.data.password)))
    return failure("UNAUTHENTICATED", "This reset link is invalid or expired.");
  return success({ reset: true as const });
}

export async function changePasswordAction(
  _previous: AppResult<{ changed: true }> | null,
  formData: FormData,
) {
  const session = await auth();
  if (!session?.user?.id) return failure("UNAUTHENTICATED", "Sign in again.");
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the password requirements.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  if (
    !(await changeTemporaryPassword(
      session.user.id,
      parsed.data.currentPassword,
      parsed.data.password,
    ))
  )
    return failure("UNAUTHENTICATED", "The current password is incorrect.");
  await signOut({ redirect: false });
  redirect("/login?passwordChanged=1");
}
