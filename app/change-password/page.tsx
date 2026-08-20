import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ChangePasswordForm } from "@/components/auth/password-forms";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Change temporary password" };
export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-5">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Secure your account</CardTitle>
          <CardDescription>
            You must replace the administrator-issued temporary password before
            opening a workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
