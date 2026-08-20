import { AiEndpointConfigurationPage } from "@/components/admin/ai-endpoint-configuration-page";

export const metadata = { title: "Add chat endpoint" };

export default function NewChatEndpointPage() {
  return <AiEndpointConfigurationPage kind="CHAT" />;
}
