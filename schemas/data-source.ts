import { z } from "zod";

export const dataSourceTypeSchema = z.enum([
  "MYSQL",
  "POSTGRESQL",
  "MSSQL",
  "ORACLE",
  "EXCEL",
]);

const baseDatabaseConnectionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(512),
  connectionOptions: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .refine(
      (options) =>
        !Object.keys(options).some((key) =>
          /password|secret|token|credential/i.test(key),
        ),
      "Secrets are not allowed in advanced parameters",
    )
    .default({}),
});

export const databaseConnectionSchema = z.discriminatedUnion("type", [
  baseDatabaseConnectionSchema.extend({
    type: z.enum(["MYSQL", "POSTGRESQL", "MSSQL"]),
    databaseName: z.string().trim().min(1).max(128),
    sslEnabled: z.coerce.boolean().default(false),
  }),
  baseDatabaseConnectionSchema
    .extend({
      type: z.literal("ORACLE"),
      databaseName: z.string().trim().min(1).max(128).optional(),
      sslEnabled: z.coerce.boolean().default(false),
      connectionType: z.enum(["service_name", "sid"]),
      serviceName: z.string().trim().min(1).max(128).optional(),
      sid: z.string().trim().min(1).max(128).optional(),
      schema: z.string().trim().min(1).max(128).optional(),
      sslMode: z.enum(["disable", "prefer", "require"]).default("disable"),
      connectionTimeoutMs: z.coerce
        .number()
        .int()
        .min(1_000)
        .max(60_000)
        .default(15_000),
    })
    .superRefine((value, ctx) => {
      if (value.connectionType === "service_name" && !value.serviceName)
        ctx.addIssue({
          code: "custom",
          message: "Service name is required",
          path: ["serviceName"],
        });
      if (value.connectionType === "sid" && !value.sid)
        ctx.addIssue({
          code: "custom",
          message: "SID is required",
          path: ["sid"],
        });
    }),
]);

const databaseConnectionUpdateBase = baseDatabaseConnectionSchema
  .omit({ password: true })
  .extend({
    dataSourceId: z.string().min(1),
    password: z.string().max(512).optional(),
  });

export const databaseConnectionUpdateSchema = z.discriminatedUnion("type", [
  databaseConnectionUpdateBase.extend({
    type: z.enum(["MYSQL", "POSTGRESQL", "MSSQL"]),
    databaseName: z.string().trim().min(1).max(128),
    sslEnabled: z.coerce.boolean().default(false),
  }),
  databaseConnectionUpdateBase
    .extend({
      type: z.literal("ORACLE"),
      databaseName: z.string().trim().min(1).max(128).optional(),
      sslEnabled: z.coerce.boolean().default(false),
      connectionType: z.enum(["service_name", "sid"]),
      serviceName: z.string().trim().min(1).max(128).optional(),
      sid: z.string().trim().min(1).max(128).optional(),
      schema: z.string().trim().min(1).max(128).optional(),
      sslMode: z.enum(["disable", "prefer", "require"]).default("disable"),
      connectionTimeoutMs: z.coerce
        .number()
        .int()
        .min(1_000)
        .max(60_000)
        .default(15_000),
    })
    .superRefine((value, ctx) => {
      if (value.connectionType === "service_name" && !value.serviceName)
        ctx.addIssue({
          code: "custom",
          message: "Service name is required",
          path: ["serviceName"],
        });
      if (value.connectionType === "sid" && !value.sid)
        ctx.addIssue({
          code: "custom",
          message: "SID is required",
          path: ["sid"],
        });
    }),
]);

export const dashboardObjectiveSchema = z.object({
  dataSourceId: z.string().min(1),
  dashboardId: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  businessArea: z.string().trim().min(2).max(120),
  businessObjective: z.string().trim().min(20).max(3000),
  businessQuestions: z.string().trim().max(2000).optional(),
  desiredKpis: z.string().trim().max(2000).optional(),
  targetUsers: z.string().trim().max(500).optional(),
  reportingPeriod: z.string().trim().max(500).optional(),
  importantFilters: z.string().trim().max(1000).optional(),
});

export const dashboardAppearanceSchema = z.object({
  dashboardId: z.string().min(1),
  layoutStyle: z.enum([
    "EXECUTIVE_OVERVIEW",
    "OPERATIONAL_MONITORING",
    "ANALYTICAL_EXPLORER",
    "CONTROL_CENTER",
    "CUSTOM",
  ]),
  visualStyle: z.enum([
    "CLEAN_PROFESSIONAL",
    "MODERN_ENTERPRISE",
    "MINIMAL_LIGHT",
    "DARK_CONTROL_ROOM",
    "DATA_DENSE",
  ]),
  visualTheme: z.enum(["BLUE", "EMERALD", "AMBER", "SLATE", "CUSTOM"]),
});

export const widgetConfigSchema = z.object({
  version: z.literal(1),
  query: z.string().max(10_000).optional(),
  visualization: z.record(z.string(), z.unknown()).default({}),
  filters: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const deleteDataSourceSchema = z.object({
  dataSourceId: z.string().min(1),
  confirmationName: z.string().trim().min(1),
});

export const dashboardMutationSchema = z.object({
  dashboardId: z.string().min(1),
});

export const deleteDashboardSchema = dashboardMutationSchema.extend({
  confirmationName: z.string().trim().min(1),
});
