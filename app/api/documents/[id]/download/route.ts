import path from "node:path";
import { getAuthorizationContext } from "@/server/auth/authorization";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { LocalObjectStorageService } from "@/server/storage/local-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAuthorizationContext();
  if (!context) return new Response(null, { status: 401 });
  const { id } = await params;
  const document = await db.document.findFirst({
    where: { id, organizationId: context.organizationId, active: true },
    include: {
      source: { select: { rackId: true } },
      currentVersion: true,
    },
  });
  if (
    !document?.currentVersion ||
    !(await authorizeResource(context, "DOCUMENT", document.id, "VIEW")).allowed
  )
    return new Response(null, { status: 404 });
  const storage = new LocalObjectStorageService(
    path.resolve(env().LOCAL_STORAGE_PATH),
  );
  const bytes = await storage.get(document.currentVersion.storageKey);
  const safeName = document.name.replace(/["\r\n]/g, "_");
  return new Response(bytes, {
    headers: {
      "content-type": document.mimeType,
      "content-length": String(bytes.length),
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
