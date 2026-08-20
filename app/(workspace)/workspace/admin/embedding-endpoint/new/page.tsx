import { AiEndpointConfigurationPage } from "@/components/admin/ai-endpoint-configuration-page";

export const metadata = { title: "Add embedding endpoint" };

export default function NewEmbeddingEndpointPage() {
  return <AiEndpointConfigurationPage kind="EMBEDDING" />;
}
