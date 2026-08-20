import { CopiedTextSourcePage } from "@/components/sources/copied-text-source-page";

export default async function EditCopiedTextSourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CopiedTextSourcePage sourceId={id} />;
}
