import { redirect } from "next/navigation";

export default async function LegacyApiRegistryRedirect({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const query = await searchParams;
  redirect(
    query.view === "wizard"
      ? "/workspace/sources/api-tools/new"
      : "/workspace/sources/api-tools",
  );
}
