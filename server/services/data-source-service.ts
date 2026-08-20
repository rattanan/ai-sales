import type { Prisma } from "@/generated/prisma/client";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { createConnector } from "@/server/connectors/factory";
import type { ConnectorConfiguration } from "@/server/connectors/types";
import { db } from "@/server/db";
import {
  AesGcmCredentialEncryptionService,
  parseEncryptionKeyRing,
} from "@/server/services/encryption";
import { logger } from "@/server/services/logger";
import { env } from "@/schemas/env";
import { failure, success } from "@/types/result";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { LocalObjectStorageService } from "@/server/storage/local-storage";
import { summarizeDataSourcePreview } from "@/server/services/source-preview-service";

function batches<T>(values: T[], size = 500) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

export function fingerprint(value: unknown) {
  const serialized = JSON.stringify(value, (_key, nested) =>
    typeof nested === "bigint" ? nested.toString() : nested,
  );
  return createHash("sha256").update(serialized).digest("hex");
}

function discoveryDiagnostics(error: unknown, operation: string) {
  const source =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : undefined;
  return {
    operation,
    errorType: error instanceof Error ? error.name : "UnknownError",
    ...(typeof source?.code === "string" ? { driverCode: source.code } : {}),
  };
}

function encryptionService() {
  const config = env();
  return new AesGcmCredentialEncryptionService(
    Buffer.from(
      config.DATA_SOURCE_ENCRYPTION_KEY ?? config.CREDENTIAL_ENCRYPTION_KEY,
      "base64",
    ),
    config.CREDENTIAL_KEY_VERSION,
    parseEncryptionKeyRing(config.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
  );
}

export async function getDataSourceConnector(
  context: AuthorizationContext,
  id: string,
) {
  const decision = await authorizeResource(context, "DATA_SOURCE", id, "VIEW");
  if (!decision.allowed) return failure("NOT_FOUND", "Data source not found.");
  const source = await db.dataSource.findFirst({
    where: { id, workspaceId: context.workspaceId },
    include: { credential: true },
  });
  if (!source) return failure("NOT_FOUND", "Data source not found.");
  let password: string | undefined;
  if (source.credential) {
    const plaintext = encryptionService().decrypt(source.credential);
    password = (JSON.parse(plaintext) as { password: string }).password;
  }
  const configuration: ConnectorConfiguration = {
    dataSourceId: source.id,
    host: source.host ?? undefined,
    port: source.port ?? undefined,
    databaseName: source.databaseName ?? undefined,
    username: source.username ?? undefined,
    password,
    sslEnabled: source.sslEnabled,
    connectionOptions:
      (source.connectionOptions as ConnectorConfiguration["connectionOptions"]) ??
      {},
    oracle:
      source.type === "ORACLE"
        ? (source.connectionOptions as ConnectorConfiguration["oracle"])
        : undefined,
  };
  return success({
    source,
    connector: createConnector(source.type, configuration),
  });
}

export async function testDataSource(
  context: AuthorizationContext,
  id: string,
) {
  const resolved = await getDataSourceConnector(context, id);
  if (!resolved.ok) return resolved;
  const { connector, source } = resolved.data;
  await db.dataSource.update({
    where: { id: source.id },
    data: { status: "TESTING" },
  });
  try {
    const result = await connector.testConnection();
    await db.$transaction([
      db.dataSource.update({
        where: { id: source.id },
        data: {
          status: result.ok ? "CONNECTED" : "FAILED",
          lastTestedAt: new Date(),
          lastConnectedAt: result.ok ? new Date() : source.lastConnectedAt,
        },
      }),
      db.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "DATA_SOURCE_TESTED",
          entityType: "DataSource",
          entityId: source.id,
          outcome: result.ok ? "SUCCESS" : "FAILURE",
          metadata: result.ok
            ? { latencyMs: result.data.latencyMs }
            : { code: result.error.code },
        },
      }),
    ]);
    return result;
  } finally {
    await connector.close();
  }
}

export async function discoverDataSource(
  context: AuthorizationContext,
  id: string,
) {
  const resolved = await getDataSourceConnector(context, id);
  if (!resolved.ok) return resolved;
  const { connector, source } = resolved.data;
  let operation = "readMetadata";
  if (source.type === "EXCEL")
    return failure(
      "CONNECTOR_NOT_IMPLEMENTED",
      "Excel metadata is managed by the workbook import pipeline.",
    );
  try {
    const schemas = await connector.listSchemas();
    if (!schemas.ok) return schemas;
    const configuredSchema =
      source.type === "ORACLE"
        ? String(
            (source.connectionOptions as { schema?: string } | null)?.schema ??
              source.username ??
              "",
          ).toUpperCase()
        : source.type === "MYSQL"
          ? source.databaseName
          : undefined;
    const schemasToScan = configuredSchema
      ? schemas.data.filter(
          (item) =>
            item.name.toLocaleLowerCase() ===
            configuredSchema.toLocaleLowerCase(),
        )
      : schemas.data;
    if (!schemasToScan.length)
      return failure(
        "CONNECTION_FAILED",
        "The configured database/schema is not accessible to this database user.",
      );
    const schemaNames = schemasToScan.map((item) => item.name);
    const [tables, columns, relationships] = await Promise.all([
      connector.listTables(schemaNames),
      connector.listColumns(schemaNames),
      connector.listRelationships(schemaNames),
    ]);
    if (!tables.ok) return tables;
    if (!columns.ok) return columns;
    if (!relationships.ok) return relationships;

    const existing = await db.dataSourceSchema.findMany({
      where: { dataSourceId: source.id },
      include: { tables: { include: { columns: true } } },
    });
    const nextVersion = source.metadataVersion + 1;
    const incomingSchemaNames = new Set(schemasToScan.map((item) => item.name));
    const incomingTables = new Map<
      string,
      (typeof tables.data)[number] & { fingerprint: string }
    >(
      tables.data.map((table) => [
        `${table.schemaName}.${table.name}`,
        {
          ...table,
          fingerprint: fingerprint({
            type: table.tableType,
            estimatedRows: table.estimatedRowCount?.toString() ?? null,
            comment: table.comment ?? null,
          }),
        },
      ]),
    );
    const incomingColumns = new Map<
      string,
      (typeof columns.data)[number] & { fingerprint: string }
    >(
      columns.data.map((column) => [
        `${column.schemaName}.${column.tableName}.${column.name}`,
        {
          ...column,
          fingerprint: fingerprint({
            type: column.dataType,
            ordinal: column.ordinal,
            nullable: column.nullable,
            primaryKey: column.primaryKey,
            defaultValue: column.defaultValue,
            comment: column.comment ?? null,
          }),
        },
      ]),
    );
    const currentSchemaNames = new Set(existing.map((schema) => schema.name));
    const currentTables = new Map<
      string,
      (typeof existing)[number]["tables"][number]
    >(
      existing.flatMap((schema) =>
        schema.tables.map(
          (table) => [`${schema.name}.${table.name}`, table] as const,
        ),
      ),
    );
    const currentColumns = new Map<
      string,
      (typeof existing)[number]["tables"][number]["columns"][number]
    >(
      existing.flatMap((schema) =>
        schema.tables.flatMap((table) =>
          table.columns.map(
            (column) =>
              [`${schema.name}.${table.name}.${column.name}`, column] as const,
          ),
        ),
      ),
    );
    const diff = {
      addedSchemas: [...incomingSchemaNames].filter(
        (name) => !currentSchemaNames.has(name),
      ).length,
      changedSchemas: 0,
      removedSchemas: [...currentSchemaNames].filter(
        (name) => !incomingSchemaNames.has(name),
      ).length,
      addedTables: [...incomingTables.keys()].filter(
        (key) => !currentTables.has(key),
      ).length,
      changedTables: [...incomingTables].filter(([key, value]) => {
        const current = currentTables.get(key);
        return current && current.metadataFingerprint !== value.fingerprint;
      }).length,
      removedTables: [...currentTables.keys()].filter(
        (key) => !incomingTables.has(key),
      ).length,
      addedColumns: [...incomingColumns.keys()].filter(
        (key) => !currentColumns.has(key),
      ).length,
      changedColumns: [...incomingColumns].filter(([key, value]) => {
        const current = currentColumns.get(key);
        return current && current.metadataFingerprint !== value.fingerprint;
      }).length,
      removedColumns: [...currentColumns.keys()].filter(
        (key) => !incomingColumns.has(key),
      ).length,
    };
    const sourceFingerprint = fingerprint({
      schemas: [...incomingSchemaNames].sort(),
      tables: [...incomingTables].sort(([a], [b]) => a.localeCompare(b)),
      columns: [...incomingColumns].sort(([a], [b]) => a.localeCompare(b)),
      relationships: relationships.data,
    });

    operation = "persistSchemas";
    await db.$transaction(
      async (tx) => {
        const schemaIds = new Map<string, string>();
        for (const schema of schemasToScan) {
          const schemaFingerprint = fingerprint({ name: schema.name });
          const createdSchema = await tx.dataSourceSchema.upsert({
            where: {
              dataSourceId_name: { dataSourceId: source.id, name: schema.name },
            },
            create: {
              dataSourceId: source.id,
              name: schema.name,
              metadataFingerprint: schemaFingerprint,
              lastSeenVersion: nextVersion,
            },
            update: {
              metadataFingerprint: schemaFingerprint,
              lastSeenVersion: nextVersion,
            },
          });
          schemaIds.set(schema.name, createdSchema.id);
        }
        await tx.dataSourceSchema.deleteMany({
          where: {
            dataSourceId: source.id,
            lastSeenVersion: { lt: nextVersion },
          },
        });
        operation = "persistTables";
        for (const table of incomingTables.values()) {
          const schemaId = schemaIds.get(table.schemaName);
          if (!schemaId) continue;
          const previous = currentTables.get(
            `${table.schemaName}.${table.name}`,
          );
          const metadataChanged =
            previous?.metadataFingerprint !== table.fingerprint;
          const persistedTable = await tx.dataSourceTable.upsert({
            where: { schemaId_name: { schemaId, name: table.name } },
            create: {
              schemaId,
              name: table.name,
              tableType: table.tableType,
              estimatedRowCount: table.estimatedRowCount,
              databaseComment: table.comment,
              metadataFingerprint: table.fingerprint,
              lastSeenVersion: nextVersion,
            },
            update: {
              tableType: table.tableType,
              estimatedRowCount: table.estimatedRowCount,
              databaseComment: table.comment,
              metadataFingerprint: table.fingerprint,
              lastSeenVersion: nextVersion,
              ...(metadataChanged
                ? {
                    semanticDescription: null,
                    semanticModel: null,
                    semanticFingerprint: null,
                    semanticEmbeddingModel: null,
                    semanticEmbeddingDimension: null,
                  }
                : {}),
            },
          });
          if (metadataChanged)
            await tx.$executeRaw`
              UPDATE "DataSourceTable"
                 SET "semanticEmbedding" = NULL
               WHERE id = ${persistedTable.id}
            `;
        }
        await tx.dataSourceTable.deleteMany({
          where: {
            schema: { dataSourceId: source.id },
            lastSeenVersion: { lt: nextVersion },
          },
        });
        const persistedTables = await tx.dataSourceTable.findMany({
          where: { schema: { dataSourceId: source.id } },
          include: { schema: { select: { name: true } } },
        });
        const tableIds = new Map(
          persistedTables.map((table) => [
            `${table.schema.name}.${table.name}`,
            table.id,
          ]),
        );
        operation = "persistColumns";
        for (const column of incomingColumns.values()) {
          const tableId = tableIds.get(
            `${column.schemaName}.${column.tableName}`,
          );
          if (!tableId) continue;
          const previous = currentColumns.get(
            `${column.schemaName}.${column.tableName}.${column.name}`,
          );
          const metadataChanged =
            previous?.metadataFingerprint !== column.fingerprint;
          await tx.dataSourceColumn.upsert({
            where: { tableId_name: { tableId, name: column.name } },
            create: {
              tableId,
              name: column.name,
              dataType: column.dataType,
              ordinal: column.ordinal,
              nullable: column.nullable,
              primaryKey: column.primaryKey,
              defaultValue: column.defaultValue,
              databaseComment: column.comment,
              metadataFingerprint: column.fingerprint,
              lastSeenVersion: nextVersion,
            },
            update: {
              dataType: column.dataType,
              ordinal: column.ordinal,
              nullable: column.nullable,
              primaryKey: column.primaryKey,
              defaultValue: column.defaultValue,
              databaseComment: column.comment,
              metadataFingerprint: column.fingerprint,
              lastSeenVersion: nextVersion,
              ...(metadataChanged
                ? {
                    semanticDescription: null,
                    semanticModel: null,
                    semanticFingerprint: null,
                  }
                : {}),
            },
          });
        }
        await tx.dataSourceColumn.deleteMany({
          where: {
            table: { schema: { dataSourceId: source.id } },
            lastSeenVersion: { lt: nextVersion },
          },
        });
        operation = "persistRelationships";
        await tx.dataSourceRelationship.deleteMany({
          where: { fromTable: { schema: { dataSourceId: source.id } } },
        });
        const relationshipRecords = relationships.data.flatMap((relation) => {
          const fromTableId = tableIds.get(
            `${relation.fromSchema}.${relation.fromTable}`,
          );
          const toTableId = tableIds.get(
            `${relation.toSchema}.${relation.toTable}`,
          );
          return fromTableId && toTableId
            ? [
                {
                  name: relation.name,
                  fromTableId,
                  fromColumnName: relation.fromColumn,
                  toTableId,
                  toColumnName: relation.toColumn,
                },
              ]
            : [];
        });
        for (const batch of batches(relationshipRecords))
          await tx.dataSourceRelationship.createMany({
            data: batch,
            skipDuplicates: true,
          });
        operation = "finalizeMetadata";
        await tx.dataSource.update({
          where: { id: source.id },
          data: {
            lastDiscoveredAt: new Date(),
            metadataVersion: nextVersion,
            metadataFingerprint: sourceFingerprint,
            lastMetadataDiff: diff,
          },
        });
        await tx.metadataRefreshRun.create({
          data: {
            dataSourceId: source.id,
            version: nextVersion,
            status: "COMPLETED",
            ...diff,
            completedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            actorId: context.userId,
            action: "METADATA_DISCOVERED",
            entityType: "DataSource",
            entityId: source.id,
            metadata: {
              schemas: schemasToScan.length,
              tables: tables.data.length,
              columns: columns.data.length,
              metadataVersion: nextVersion,
              diff,
            },
          },
        });
      },
      // Oracle schemas can contain thousands of objects/columns. Persisting
      // governed metadata is intentionally bounded but needs longer than the
      // Prisma interactive transaction default of five seconds.
      { maxWait: 10_000, timeout: 300_000 },
    );
    await summarizeDataSourcePreview(context, source.id).catch((error) =>
      logger.warn("Data source preview summary failed", {
        dataSourceId: source.id,
        error,
      }),
    );
    return success({
      schemas: schemasToScan.length,
      tables: tables.data.length,
      columns: columns.data.length,
      metadataVersion: nextVersion,
      diff,
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    const diagnostics = discoveryDiagnostics(error, operation);
    logger.error("Metadata discovery failed", {
      requestId,
      dataSourceId: id,
      diagnostics,
      error,
    });
    return failure(
      "CONNECTION_FAILED",
      "Metadata discovery failed. Verify that the database user can read the permitted metadata views.",
      { requestId, diagnostics },
    );
  } finally {
    await connector.close();
  }
}

export async function createDatabaseDataSource(
  context: AuthorizationContext,
  input: {
    type: "MYSQL" | "POSTGRESQL" | "MSSQL" | "ORACLE";
    name: string;
    host: string;
    port: number;
    databaseName?: string;
    username: string;
    password: string;
    sslEnabled: boolean;
    connectionOptions: Record<string, string | number | boolean>;
    connectionType?: "service_name" | "sid";
    serviceName?: string;
    sid?: string;
    schema?: string;
    sslMode?: "disable" | "prefer" | "require";
    connectionTimeoutMs?: number;
  },
) {
  const encrypted = encryptionService().encrypt(
    JSON.stringify({ password: input.password }),
  );
  const source = await db.$transaction(async (tx) => {
    const created = await tx.dataSource.create({
      data: {
        workspaceId: context.workspaceId,
        name: input.name,
        type: input.type,
        host: input.host,
        port: input.port,
        databaseName:
          input.type === "ORACLE"
            ? (input.serviceName ?? input.sid ?? null)
            : input.databaseName,
        username: input.username,
        sslEnabled: input.sslEnabled,
        connectionOptions: (input.type === "ORACLE"
          ? {
              connectionType: input.connectionType!,
              serviceName: input.serviceName,
              sid: input.sid,
              schema: input.schema,
              sslMode: input.sslMode,
              connectionTimeoutMs: input.connectionTimeoutMs,
            }
          : input.connectionOptions) as Prisma.InputJsonValue,
        createdById: context.userId,
        credential: { create: encrypted },
        access: {
          create: {
            organizationId: context.organizationId,
            userId: context.userId,
            grantedById: context.userId,
            canPreview: true,
            canBuild: true,
            canManage: true,
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DATA_SOURCE_CREATED",
        entityType: "DataSource",
        entityId: created.id,
        metadata: { type: created.type },
      },
    });
    return created;
  });
  return success({
    id: source.id,
    status: source.status,
    hasStoredCredential: true,
  });
}

export async function updateDatabaseDataSource(
  context: AuthorizationContext,
  input: {
    dataSourceId: string;
    type: "MYSQL" | "POSTGRESQL" | "MSSQL" | "ORACLE";
    name: string;
    host: string;
    port: number;
    databaseName?: string;
    username: string;
    password?: string;
    sslEnabled: boolean;
    connectionOptions: Record<string, string | number | boolean>;
    connectionType?: "service_name" | "sid";
    serviceName?: string;
    sid?: string;
    schema?: string;
    sslMode?: "disable" | "prefer" | "require";
    connectionTimeoutMs?: number;
  },
) {
  const source = await db.dataSource.findFirst({
    where: { id: input.dataSourceId, workspaceId: context.workspaceId },
  });
  if (!source) return failure("NOT_FOUND", "Data source not found.");
  if (source.type !== input.type)
    return failure(
      "VALIDATION_ERROR",
      "The database type cannot be changed after creation.",
    );

  const databaseName =
    input.type === "ORACLE"
      ? (input.serviceName ?? input.sid ?? null)
      : (input.databaseName ?? null);
  const connectionOptions = (input.type === "ORACLE"
    ? {
        connectionType: input.connectionType!,
        serviceName: input.serviceName,
        sid: input.sid,
        schema: input.schema,
        sslMode: input.sslMode,
        connectionTimeoutMs: input.connectionTimeoutMs,
      }
    : input.connectionOptions) as Prisma.InputJsonValue;
  const connectionChanged =
    source.host !== input.host ||
    source.port !== input.port ||
    source.databaseName !== databaseName ||
    source.username !== input.username ||
    source.sslEnabled !== input.sslEnabled ||
    fingerprint(source.connectionOptions) !== fingerprint(connectionOptions) ||
    Boolean(input.password);
  const encrypted = input.password
    ? encryptionService().encrypt(JSON.stringify({ password: input.password }))
    : undefined;

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.dataSource.update({
      where: { id: source.id },
      data: {
        name: input.name,
        host: input.host,
        port: input.port,
        databaseName,
        username: input.username,
        sslEnabled: input.sslEnabled,
        connectionOptions,
        ...(connectionChanged
          ? {
              status: "DRAFT" as const,
              sourceStatus: "DRAFT" as const,
              lastTestedAt: null,
            }
          : {}),
        ...(encrypted
          ? {
              credential: {
                upsert: { create: encrypted, update: encrypted },
              },
            }
          : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DATA_SOURCE_UPDATED",
        entityType: "DataSource",
        entityId: source.id,
        outcome: "SUCCESS",
        metadata: { connectionChanged, credentialRotated: Boolean(encrypted) },
      },
    });
    return saved;
  });
  return success({
    id: updated.id,
    status: updated.status,
    hasStoredCredential: true,
  });
}

export async function deleteDataSource(
  context: AuthorizationContext,
  id: string,
  confirmationName: string,
) {
  const source = await db.dataSource.findFirst({
    where: { id, workspaceId: context.workspaceId },
    include: {
      file: { select: { storageKey: true } },
      _count: { select: { dashboards: true } },
    },
  });
  if (!source) return failure("NOT_FOUND", "Data source not found.");
  if (confirmationName !== source.name) {
    return failure(
      "VALIDATION_ERROR",
      "The confirmation name does not match the data source name.",
      {
        fieldErrors: {
          confirmationName: ["Enter the exact data source name."],
        },
      },
    );
  }

  const requestId = crypto.randomUUID();
  await db.$transaction(async (tx) => {
    await tx.dataSource.delete({
      where: { id: source.id, workspaceId: context.workspaceId },
    });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DATA_SOURCE_DELETED",
        entityType: "DataSource",
        entityId: source.id,
        requestId,
        metadata: {
          name: source.name,
          type: source.type,
          detachedDashboards: source._count.dashboards,
          hadStoredFile: Boolean(source.file),
        },
      },
    });
  });

  if (source.file) {
    try {
      const config = env();
      if (config.OBJECT_STORAGE_DRIVER === "local") {
        await new LocalObjectStorageService(
          path.resolve(config.LOCAL_STORAGE_PATH),
        ).delete(source.file.storageKey);
      }
    } catch (error) {
      logger.error("Deleted data source left an object-storage orphan", {
        requestId,
        dataSourceId: source.id,
        storageKey: source.file.storageKey,
        error,
      });
    }
  }

  return success({ deleted: true as const, id: source.id });
}
