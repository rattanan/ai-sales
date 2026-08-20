import { BotConfigurationPage } from "@/components/knowledge/bot-configuration-page";

export default async function EditBotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BotConfigurationPage botId={id} />;
}
