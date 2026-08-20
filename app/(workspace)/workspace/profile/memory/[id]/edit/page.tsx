import { MemoryConfigurationPage } from "@/components/memory/memory-configuration-page";

export default async function EditMemoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MemoryConfigurationPage memoryId={id} />;
}
