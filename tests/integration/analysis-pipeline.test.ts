import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { AesGcmCredentialEncryptionService } from "@/server/services/encryption";
import {
  advanceAnalysisJob,
  createAnalysisJob,
} from "@/server/services/analysis-job-service";
import { runAnalysisStage } from "@/server/services/analysis-stage-runner";
import {
  finalizeAnalysisDashboard,
  updateRecommendationDecision,
} from "@/server/services/analysis-review-service";

const enabled = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_MYSQL_HOST,
);
const prisma = process.env.TEST_DATABASE_URL
  ? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL,
      }),
    })
  : null;

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma?.$disconnect());

describe.skipIf(!enabled)("mocked AI analysis pipeline", () => {
  it("grounds, executes, reviews, and finalizes a complete dashboard", async () => {
    const suffix = crypto.randomUUID();
    const user = await prisma!.user.create({
      data: { email: `pipeline-${suffix}@example.test` },
    });
    const organization = await prisma!.organization.create({
      data: {
        name: "Pipeline Organization",
        slug: `pipeline-${suffix}`,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    const workspace = await prisma!.workspace.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: "Pipeline",
        slug: "pipeline",
      },
    });
    const encrypted = new AesGcmCredentialEncryptionService(
      Buffer.alloc(32),
    ).encrypt(JSON.stringify({ password: "readonly_password" }));
    const source = await prisma!.dataSource.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: "Fixture",
        type: "MYSQL",
        status: "CONNECTED",
        host: process.env.TEST_MYSQL_HOST,
        port: Number(process.env.TEST_MYSQL_PORT || 3306),
        databaseName: "analytics_fixture",
        username: "readonly_user",
        credential: { create: encrypted },
      },
    });
    const schema = await prisma!.dataSourceSchema.create({
      data: { dataSourceId: source.id, name: "analytics_fixture" },
    });
    const customers = await prisma!.dataSourceTable.create({
      data: {
        schemaId: schema.id,
        name: "customers",
        tableType: "TABLE",
        selected: true,
        columns: {
          createMany: {
            data: [
              {
                name: "id",
                dataType: "bigint",
                ordinal: 1,
                nullable: false,
                primaryKey: true,
              },
              {
                name: "name",
                dataType: "varchar(120)",
                ordinal: 2,
                nullable: false,
              },
              {
                name: "region",
                dataType: "varchar(40)",
                ordinal: 3,
                nullable: false,
              },
            ],
          },
        },
      },
    });
    const orders = await prisma!.dataSourceTable.create({
      data: {
        schemaId: schema.id,
        name: "orders",
        tableType: "TABLE",
        selected: true,
        columns: {
          createMany: {
            data: [
              {
                name: "id",
                dataType: "bigint",
                ordinal: 1,
                nullable: false,
                primaryKey: true,
              },
              {
                name: "customer_id",
                dataType: "bigint",
                ordinal: 2,
                nullable: false,
              },
              {
                name: "total",
                dataType: "decimal(12,2)",
                ordinal: 3,
                nullable: false,
              },
              {
                name: "ordered_at",
                dataType: "datetime",
                ordinal: 4,
                nullable: false,
              },
            ],
          },
        },
      },
    });
    await prisma!.dataSourceRelationship.create({
      data: {
        name: "fk_orders_customer",
        fromTableId: orders.id,
        fromColumnName: "customer_id",
        toTableId: customers.id,
        toColumnName: "id",
      },
    });
    const dashboard = await prisma!.dashboard.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: "Revenue overview",
        businessArea: "Commerce",
        businessObjective:
          "Monitor total order revenue for the executive operations team.",
        desiredKpis: "Total revenue",
        targetUsers: "Executive operations",
        reportingPeriod: "Monthly",
        dataSources: { create: { dataSourceId: source.id } },
      },
    });
    const context = {
      userId: user.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
      role: "OWNER" as const,
    };
    const created = await createAnalysisJob(context, dashboard.id);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const jobId = created.data.id;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const schemaName = body.response_format.json_schema.name;
        const query = await prisma!.queryDefinition.findFirst({
          where: { analysisJobId: jobId },
        });
        const outputs: Record<string, unknown> = {
          business_schema_analysis: {
            summary: "Orders are transactions linked to customer masters.",
            businessDomain: "Commerce",
            entities: [
              {
                name: "Order",
                description: "Customer purchase transaction",
                tables: ["analytics_fixture.orders"],
                confidence: 1,
              },
            ],
            factTables: [
              {
                table: "analytics_fixture.orders",
                reason: "Contains order measures",
                confidence: 1,
              },
            ],
            dimensionTables: [
              {
                table: "analytics_fixture.customers",
                reason: "Customer master",
                confidence: 1,
              },
            ],
            eventTables: [],
            dateColumns: [
              {
                column: "analytics_fixture.orders.ordered_at",
                reason: "Order timestamp",
                confidence: 1,
              },
            ],
            measureColumns: [
              {
                column: "analytics_fixture.orders.total",
                reason: "Order value",
                confidence: 1,
              },
            ],
            statusColumns: [],
            categoryColumns: [
              {
                column: "analytics_fixture.customers.region",
                reason: "Regional category",
                confidence: 1,
              },
            ],
            relationshipFindings: [
              {
                relationshipName: "fk_orders_customer",
                fromTable: "analytics_fixture.orders",
                toTable: "analytics_fixture.customers",
                finding: "Each order belongs to a customer.",
                confidence: 1,
              },
            ],
            dataQualityWarnings: [],
            clarificationQuestions: [],
          },
          kpi_recommendations: {
            recommendations: [
              {
                id: "total_revenue",
                name: "Total revenue",
                description: "Sum of order totals.",
                businessQuestion: "What is total order revenue?",
                calculationType: "SUM",
                sourceTables: ["analytics_fixture.orders"],
                sourceColumns: ["analytics_fixture.orders.total"],
                dateColumn: "analytics_fixture.orders.ordered_at",
                aggregationPeriod: "MONTH",
                filterAssumptions: [],
                proposedSql:
                  "SELECT SUM(total) AS total_revenue FROM analytics_fixture.orders LIMIT 1000",
                displayFormat: "CURRENCY",
                confidence: 1,
                limitations: [],
              },
            ],
          },
          dashboard_plan: {
            title: "Revenue overview",
            narrative: "Executive order revenue overview.",
            targetAudience: ["Executive operations"],
            sections: [
              {
                id: "overview",
                title: "Overview",
                purpose: "Show total revenue.",
                businessQuestion: "What is total revenue?",
                recommendedWidgetTypes: ["KPI"],
                priority: 1,
                layoutSize: "SMALL",
                relatedKpiIds: ["total_revenue"],
                relatedQueryIds: query ? [query.id] : [],
              },
            ],
            globalFilters: [],
            warnings: [],
          },
          dashboard_widgets: {
            widgets: [
              {
                id: "total_revenue_card",
                type: "KPI",
                title: "Total revenue",
                businessQuestion: "What is total revenue?",
                queryDefinitionId: query?.id,
                layout: { x: 0, y: 0, width: 3, height: 2 },
                visualization: {
                  valueField: "total_revenue",
                  showLegend: false,
                  palette: "BLUE",
                },
                dataMapping: {
                  dimensions: [],
                  measures: ["total_revenue"],
                },
                formatting: {
                  displayFormat: "CURRENCY",
                  decimals: 2,
                  currency: "USD",
                  compact: false,
                },
                emptyStateMessage: "No revenue data",
              },
            ],
          },
          grounded_insights: {
            insights: [
              {
                title: "Observed revenue",
                statement: "The validated preview reports total order revenue.",
                supportingWidgetIds: ["total_revenue_card"],
                supportingQueryIds: query ? [query.id] : [],
                confidence: 1,
                caveats: ["Based on the current bounded preview."],
              },
            ],
          },
        };
        return Response.json({
          choices: [
            { message: { content: JSON.stringify(outputs[schemaName]) } },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });
      }),
    );

    for (let stage = 0; stage < 9; stage++) {
      const advanced = await advanceAnalysisJob(
        context,
        jobId,
        runAnalysisStage,
      );
      if (!advanced.ok) throw new Error(JSON.stringify(advanced.error));
    }
    const waiting = await prisma!.analysisJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(waiting.status).toBe("WAITING_FOR_APPROVAL");
    const recommendations = await prisma!.analysisRecommendation.findMany({
      where: { analysisJobId: jobId },
    });
    for (const recommendation of recommendations) {
      const reviewed = await updateRecommendationDecision(context, {
        recommendationId: recommendation.id,
        decision: "APPROVED",
        title: recommendation.title,
        description: recommendation.description ?? "",
      });
      expect(reviewed.ok).toBe(true);
    }
    const finalized = await finalizeAnalysisDashboard(context, jobId);
    expect(finalized.ok).toBe(true);
    expect(
      await prisma!.dashboard.findUnique({ where: { id: dashboard.id } }),
    ).toMatchObject({ status: "GENERATED" });
    expect(
      await prisma!.dashboardWidget.count({
        where: { dashboardId: dashboard.id },
      }),
    ).toBe(1);
    expect(
      await prisma!.analysisArtifact.count({
        where: { analysisJobId: jobId },
      }),
    ).toBeGreaterThanOrEqual(6);

    await prisma!.organization.delete({ where: { id: organization.id } });
    await prisma!.user.delete({ where: { id: user.id } });
  });
});
