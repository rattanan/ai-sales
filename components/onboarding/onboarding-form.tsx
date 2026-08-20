"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { onboardingAction } from "@/features/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(onboardingAction, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-5">
      <Field
        label="Organization name"
        htmlFor="organizationName"
        required
        hint="Usually your company or operating unit."
        error={errors?.organizationName?.[0]}
      >
        <Input
          id="organizationName"
          name="organizationName"
          autoFocus
          required
        />
      </Field>
      <Field
        label="Workspace name"
        htmlFor="workspaceName"
        required
        hint="A focused area for data sources and dashboards."
        error={errors?.workspaceName?.[0]}
      >
        <Input
          id="workspaceName"
          name="workspaceName"
          placeholder="Analytics"
          required
        />
      </Field>
      <Button className="w-full" disabled={pending}>
        {pending ? <LoaderCircle size={18} className="animate-spin" /> : null}
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
