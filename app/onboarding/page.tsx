import { redirect } from "next/navigation";
import {
  getAuthorizationContext,
  requireUser,
} from "@/server/auth/authorization";
import {
  InsightKmMark,
  InsightKmWordmark,
} from "@/components/brand/insightkm-mark";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Create workspace" };
export default async function OnboardingPage() {
  await requireUser();
  if (await getAuthorizationContext()) redirect("/workspace");
  return (
    <main
      id="main-content"
      className="grid min-h-dvh place-items-center bg-background px-4 py-10"
    >
      <div className="w-full max-w-lg">
        <div className="mb-7 flex items-center justify-center gap-3">
          <InsightKmMark />
          <InsightKmWordmark />
        </div>
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              First-time setup
            </p>
            <CardTitle className="mt-2 text-2xl">
              Create your workspace
            </CardTitle>
            <CardDescription>
              Organizations keep membership and audit history separate.
              Workspaces contain your governed knowledge sources and insights.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
