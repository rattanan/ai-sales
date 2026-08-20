import { AiEndpointPage } from "@/components/admin/ai-endpoint-page";

export const metadata = { title: "Embedding endpoint" };

export default function EmbeddingEndpointPage() {
  return <AiEndpointPage kind="EMBEDDING" />;
}
