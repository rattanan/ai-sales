import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { AesGcmCredentialEncryptionService } from "@/server/services/encryption";

const connectionString = process.env.DATABASE_URL;
const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
if (!connectionString || !encryptionKey)
  throw new Error("DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY are required");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function setup(hostOrigin: string) {
  const suffix = crypto.randomUUID();
  const signingSecret = `widget-e2e-${suffix}`;
  const owner = await prisma.user.create({
    data: {
      email: `widget-owner-${suffix}@example.test`,
      status: "ACTIVE",
    },
  });
  const organization = await prisma.organization.create({
    data: { name: "Widget E2E", slug: `widget-e2e-${suffix}` },
  });
  await prisma.workspace.create({
    data: {
      organizationId: organization.id,
      createdById: owner.id,
      name: "Widget E2E",
      slug: "widget-e2e",
    },
  });
  const role = await prisma.role.create({
    data: {
      organizationId: organization.id,
      name: `Widget E2E ${suffix}`,
      systemKey: `WIDGET_E2E_${suffix.replaceAll("-", "")}`,
    },
  });
  const botUse = await prisma.permission.upsert({
    where: { key: "bot.use" },
    update: {},
    create: { key: "bot.use" },
  });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permissionId: botUse.id },
  });
  const bot = await prisma.bot.create({
    data: {
      organizationId: organization.id,
      createdById: owner.id,
      name: "Widget E2E Assistant",
      systemPrompt: "Use only evidence.",
      welcomeMessage: "Welcome to the secure widget.",
      active: true,
      access: {
        create: {
          organizationId: organization.id,
          roleId: role.id,
          level: "USE",
        },
      },
    },
  });
  const policy = await prisma.authenticationPolicy.create({
    data: {
      organizationId: organization.id,
      localEnabled: true,
      embeddedEnabled: true,
    },
  });
  const encrypted = new AesGcmCredentialEncryptionService(
    Buffer.from(encryptionKey!, "base64"),
    process.env.CREDENTIAL_KEY_VERSION ?? "env-v1",
  ).encrypt(signingSecret);
  await prisma.embeddedAuthConfig.create({
    data: {
      policyId: policy.id,
      keyId: `widget-key-${suffix}`,
      allowedOrigins: [hostOrigin],
      ...encrypted,
    },
  });
  return {
    organizationId: organization.id,
    ownerId: owner.id,
    botId: bot.id,
    role: role.name,
    signingSecret,
  };
}

async function cleanup(organizationId: string, ownerId: string) {
  await prisma.organization
    .delete({ where: { id: organizationId } })
    .catch(() => undefined);
  await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  return { cleaned: true };
}

async function main() {
  const action = process.argv[2];
  const result =
    action === "setup"
      ? await setup(process.argv[3])
      : action === "cleanup"
        ? await cleanup(process.argv[3], process.argv[4])
        : (() => {
            throw new Error(
              "Use setup <origin> or cleanup <organizationId> <ownerId>",
            );
          })();
  process.stdout.write(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
