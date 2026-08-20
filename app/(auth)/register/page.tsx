import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Create account" };
export default async function RegisterPage() {
  if ((await auth())?.user?.id) redirect("/workspace");
  return (
    <Card>
      <CardHeader className="pb-5">
        <CardTitle className="text-2xl">Registration is disabled</CardTitle>
        <CardDescription>
          InsightKM uses administrator-managed enterprise accounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-muted-foreground">
          Contact your system administrator to request access. If you already
          have an account, use the sign-in page.
        </p>
        <a
          href="/login"
          className="mt-5 inline-flex min-h-11 items-center font-semibold text-primary hover:underline"
        >
          Return to sign in
        </a>
      </CardContent>
    </Card>
  );
}
