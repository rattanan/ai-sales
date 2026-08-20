import { databaseConnectionSchema } from "@/schemas/data-source";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { createConnector } from "@/server/connectors/factory";
import type { ConnectorConfiguration } from "@/server/connectors/types";
import { failure } from "@/types/result";

export async function POST(request: Request) {
  try {
    const context = await requireAuthorization();
    await requirePermission(context, "datasource.create");
    const payload = (await request.json()) as {
      type?: unknown;
      config?: unknown;
    };
    const candidate =
      payload.config && typeof payload.config === "object"
        ? (() => {
            const config = { ...(payload.config as Record<string, unknown>) };
            delete config.connectionOptions;
            if (config.databaseName === "") delete config.databaseName;
            return { ...config, type: payload.type, name: "Connection test" };
          })()
        : payload;
    const parsed = databaseConnectionSchema.safeParse(candidate);
    if (!parsed.success)
      return Response.json(
        failure("VALIDATION_ERROR", "Please correct the connection details.", {
          fieldErrors: parsed.error.flatten().fieldErrors,
        }),
        { status: 422 },
      );
    if (parsed.data.type !== "ORACLE")
      return Response.json(
        failure(
          "VALIDATION_ERROR",
          "This endpoint currently tests Oracle connections.",
        ),
        { status: 422 },
      );
    const config: ConnectorConfiguration = {
      host: parsed.data.host,
      port: parsed.data.port,
      username: parsed.data.username,
      password: parsed.data.password,
      oracle: {
        connectionType: parsed.data.connectionType,
        serviceName: parsed.data.serviceName,
        sid: parsed.data.sid,
        schema: parsed.data.schema,
        sslMode: parsed.data.sslMode,
        connectionTimeoutMs: parsed.data.connectionTimeoutMs,
      },
    };
    const connector = createConnector("ORACLE", config);
    try {
      const result = await connector.testConnection();
      if (!result.ok) return Response.json(result, { status: 422 });
      return Response.json({
        ok: true,
        data: {
          success: true,
          databaseType: "oracle",
          databaseVersion: result.data.serverVersion,
          currentUser: result.data.currentUser,
          currentSchema: result.data.currentSchema,
          latencyMs: result.data.latencyMs,
          message: "Connection successful",
        },
      });
    } finally {
      await connector.close();
    }
  } catch {
    return Response.json(
      failure("FORBIDDEN", "You do not have permission to test data sources."),
      { status: 403 },
    );
  }
}
