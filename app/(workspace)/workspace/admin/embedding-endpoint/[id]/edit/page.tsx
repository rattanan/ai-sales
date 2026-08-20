import { AiEndpointConfigurationPage } from "@/components/admin/ai-endpoint-configuration-page";

export const metadata = { title: "Edit embedding endpoint" };

export default async function EditEmbeddingEndpointPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AiEndpointConfigurationPage kind="EMBEDDING" endpointId={id} />;
}
