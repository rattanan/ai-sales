import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { KnowledgeExplorer } from "@/components/knowledge/knowledge-explorer";
import { AddKnowledgeWizard } from "@/components/sources/add-knowledge-wizard";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { configuredGoogleDriveServiceAccountEmail } from "@/packages/knowledge/google-drive-url";

export const metadata = { title: "All knowledge" };

export default async function KnowledgeExplorerPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const googleDriveEmail = configuredGoogleDriveServiceAccountEmail(
    env().GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
  );
  const [racks, bots] = await Promise.all([
    db.knowledgeRack.findMany({
      where: { organizationId: context.organizationId },
      include: {
        bots: { include: { bot: { select: { name: true } } } },
        sources: {
          include: {
            _count: { select: { documents: true } },
            botAssignments: {
              include: { bot: { select: { name: true } } },
              orderBy: { priority: "asc" },
            },
            documents: {
              where: { active: true },
              orderBy: { updatedAt: "desc" },
              select: {
                id: true,
                name: true,
                mimeType: true,
                updatedAt: true,
                currentVersion: {
                  select: {
                    status: true,
                    _count: { select: { chunks: true } },
                  },
                },
                versions: {
                  orderBy: { version: "desc" },
                  take: 1,
                  select: { status: true },
                },
              },
            },
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.bot.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const folders = racks.map((rack) => ({
    id: rack.id,
    name: rack.name,
    description: rack.description,
    scope: rack.scope,
    botNames: rack.bots.map((item) => item.bot.name),
    documentCount: rack.sources.reduce(
      (total, source) => total + source._count.documents,
      0,
    ),
    sources: rack.sources.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.type,
      status: source.status,
      scope: source.scope,
      active: source.active,
      description: source.description,
      documentCount: source.documents.length,
      chunkCount: source.documents.reduce(
        (total, document) =>
          total + (document.currentVersion?._count.chunks ?? 0),
        0,
      ),
      updatedAt: dateFormatter.format(source.updatedAt),
      botNames: source.botAssignments.map((item) => item.bot.name),
      documents: source.documents.map((document) => ({
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        status:
          document.currentVersion?.status ??
          document.versions[0]?.status ??
          "UPLOADED",
        chunkCount: document.currentVersion?._count.chunks ?? 0,
        updatedAt: dateFormatter.format(document.updatedAt),
      })),
    })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge"
        title="All knowledge"
        description="Choose a folder to browse its sources. Open any source to review its configuration, documents, indexing status, and refresh history."
        action={
          <div className="flex flex-wrap gap-2">
            <AddKnowledgeWizard
              key={folders.reduce(
                (total, folder) => total + folder.sources.length,
                0,
              )}
              folders={racks
                .filter((rack) => rack.active)
                .map((rack) => ({ id: rack.id, name: rack.name }))}
              bots={bots}
              googleDriveServiceAccountEmail={googleDriveEmail}
            />
            <Link
              href="/workspace/admin/knowledge/access"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"
            >
              <LockKeyhole size={17} /> Access control
            </Link>
          </div>
        }
      />
      <KnowledgeExplorer folders={folders} />
    </div>
  );
}
