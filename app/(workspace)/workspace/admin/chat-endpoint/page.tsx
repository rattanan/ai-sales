import { AiEndpointPage } from "@/components/admin/ai-endpoint-page";

export const metadata = { title: "Chat AI endpoint" };

export default function ChatAiEndpointPage() {
  return <AiEndpointPage kind="CHAT" />;
}
