import { ProviderConfigurationPage } from "@/components/admin/provider-configuration-page";

export default async function EditProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProviderConfigurationPage providerId={id} />;
}
