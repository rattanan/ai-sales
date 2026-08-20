import { AiEndpointConfigurationPage } from "@/components/admin/ai-endpoint-configuration-page";

export const metadata = { title: "Edit chat endpoint" };

export default async function EditChatEndpointPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AiEndpointConfigurationPage kind="CHAT" endpointId={id} />;
}
