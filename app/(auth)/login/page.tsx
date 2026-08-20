import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Sign in" };
export default async function LoginPage() {
  if ((await auth())?.user?.id) redirect("/workspace");
  return (
    <Card>
      <CardHeader className="pb-5">
        <CardTitle className="text-2xl">Welcome to InsightKM</CardTitle>
        <CardDescription>
          Sign in to access your organization&apos;s trusted knowledge.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
