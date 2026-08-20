import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { PERMISSIONS, SYSTEM_ROLES } from "../server/auth/permission-catalog";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required to seed the database");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main() {
  const adminName = process.env.INITIAL_ADMIN_NAME;
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL?.toLowerCase();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const adminUsername = process.env.INITIAL_ADMIN_USERNAME?.toLowerCase();
  if (!adminName || !adminEmail || !adminPassword)
    throw new Error(
      "INITIAL_ADMIN_NAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD are required to seed.",
    );
  const [adminByEmail, adminByUsername] = await Promise.all([
    prisma.user.findUnique({ where: { email: adminEmail } }),
    adminUsername
      ? prisma.user.findUnique({ where: { username: adminUsername } })
      : null,
  ]);
  if (adminByEmail && adminByUsername && adminByEmail.id !== adminByUsername.id)
    throw new Error(
      "INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_USERNAME belong to different existing users.",
    );
  const existingAdmin = adminByEmail ?? adminByUsername;
  const user = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          name: adminName,
          email: adminEmail,
          username: adminUsername,
          status: "ACTIVE",
          deletedAt: null,
        },
      })
    : await prisma.user.create({
        data: {
          name: adminName,
          email: adminEmail,
          username: adminUsername,
          status: "ACTIVE",
          mustChangePassword: true,
          passwordHash: await hash(adminPassword, {
            algorithm: 2,
            memoryCost: 19456,
            timeCost: 2,
          }),
        },
      });
  const organization = await prisma.organization.upsert({
    where: { slug: "initial-organization" },
    update: { name: "Initial Organization" },
    create: { name: "Initial Organization", slug: "initial-organization" },
  });
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: { role: "OWNER" },
    create: { organizationId: organization.id, userId: user.id, role: "OWNER" },
  });
  const workspace = await prisma.workspace.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "main",
      },
    },
    update: { name: "Main Workspace" },
    create: {
      organizationId: organization.id,
      name: "Main Workspace",
      slug: "main",
      createdById: user.id,
    },
  });
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }
  const rolesByKey = new Map<string, string>();
  for (const [systemKey, definition] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: {
        organizationId_systemKey: {
          organizationId: organization.id,
          systemKey,
        },
      },
      update: { name: definition.name, description: definition.description },
      create: {
        organizationId: organization.id,
        systemKey,
        isSystem: true,
        name: definition.name,
        description: definition.description,
      },
    });
    rolesByKey.set(systemKey, role.id);
    const permissionRows = await prisma.permission.findMany({
      where: { key: { in: [...definition.permissions] } },
      select: { id: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissionRows.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
      })),
    });
    if (["ADMIN", "SYSTEM_ADMIN"].includes(systemKey)) {
      await prisma.userRole.upsert({
        where: {
          organizationId_userId_roleId: {
            organizationId: organization.id,
            userId: user.id,
            roleId: role.id,
          },
        },
        update: {},
        create: {
          organizationId: organization.id,
          userId: user.id,
          roleId: role.id,
        },
      });
      await prisma.aIAccessPolicy.upsert({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: user.id,
          },
        },
        update: { copilotEnabled: true },
        create: {
          organizationId: organization.id,
          userId: user.id,
          copilotEnabled: true,
        },
      });
    }
  }
  const generalUnit = await prisma.organizationUnit.upsert({
    where: {
      organizationId_code: { organizationId: organization.id, code: "GENERAL" },
    },
    update: { active: true },
    create: {
      organizationId: organization.id,
      name: "General",
      code: "GENERAL",
      description: "Default organization unit",
    },
  });
  const generalProject = await prisma.organizationProject.upsert({
    where: {
      organizationId_code: { organizationId: organization.id, code: "GENERAL" },
    },
    update: { active: true },
    create: {
      organizationId: organization.id,
      name: "General",
      code: "GENERAL",
      description: "Default project scope",
    },
  });
  await prisma.piiMaskingPolicy.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: { organizationId: organization.id },
  });
  await prisma.systemRetentionPolicy.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: { organizationId: organization.id },
  });
  await prisma.authenticationPolicy.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      organizationId: organization.id,
      localEnabled: true,
      externalApiEnabled: false,
      embeddedEnabled: false,
      modePriority: ["EMBEDDED", "EXTERNAL_API", "LOCAL"],
    },
  });
  const generalRack = await prisma.knowledgeRack.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "General Knowledge",
      },
    },
    update: {
      active: true,
      description: "Default governed document collection for InsightKM.",
    },
    create: {
      organizationId: organization.id,
      createdById: user.id,
      name: "General Knowledge",
      description: "Default governed document collection for InsightKM.",
    },
  });
  await prisma.knowledgeSource.upsert({
    where: {
      rackId_name: { rackId: generalRack.id, name: "Files" },
    },
    update: { active: true },
    create: { rackId: generalRack.id, name: "Files", type: "FILE" },
  });
  const knowledgeRoleIds = ["ADMIN", "SYSTEM_ADMIN", "MANAGER", "USER"]
    .map((key) => rolesByKey.get(key))
    .filter((roleId): roleId is string => Boolean(roleId));
  for (const roleId of knowledgeRoleIds) {
    await prisma.knowledgeRackAccess.upsert({
      where: { rackId_roleId: { rackId: generalRack.id, roleId } },
      update: { level: "READ" },
      create: {
        organizationId: organization.id,
        rackId: generalRack.id,
        roleId,
        level: "READ",
      },
    });
  }
  await prisma.knowledgeRackAccess.upsert({
    where: { rackId_userId: { rackId: generalRack.id, userId: user.id } },
    update: { level: "MANAGE" },
    create: {
      organizationId: organization.id,
      rackId: generalRack.id,
      userId: user.id,
      level: "MANAGE",
    },
  });
  const defaultBot = await prisma.bot.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "InsightKM Assistant",
      },
    },
    update: {
      active: true,
      description:
        "ผู้ช่วยความรู้องค์กรแบบมีการกำกับดูแล / Governed organizational knowledge assistant.",
      welcomeMessage:
        "สวัสดีครับ ถามได้ทั้งภาษาไทยและอังกฤษจากข้อมูลที่คุณมีสิทธิ์เข้าถึง / Ask in Thai or English from knowledge you are allowed to access.",
      suggestedQuestions: [
        "สรุปนโยบายที่ฉันมีสิทธิ์เข้าถึง",
        "มีช่องว่างความรู้เรื่องใดบ้าง",
        "Summarize the policies I can access.",
        "Which knowledge gaps need review?",
      ],
    },
    create: {
      organizationId: organization.id,
      createdById: user.id,
      name: "InsightKM Assistant",
      description: "Answers from governed organizational knowledge.",
      systemPrompt:
        "Answer only from the governed evidence provided by InsightKM. Be concise, preserve the user's language, and state clearly when evidence is insufficient.",
      welcomeMessage:
        "สวัสดีครับ ถามข้อมูลจากเอกสารที่คุณมีสิทธิ์เข้าถึงได้เลย",
      suggestedQuestions: [
        "สรุปนโยบายที่ฉันมีสิทธิ์เข้าถึง",
        "มีช่องว่างความรู้เรื่องใดบ้าง",
        "Summarize the policies I can access.",
        "Which knowledge gaps need review?",
      ],
      active: true,
    },
  });
  await prisma.botProviderConfig.upsert({
    where: { botId: defaultBot.id },
    update: { citationEnabled: true, memoryMode: "CONVERSATION" },
    create: {
      botId: defaultBot.id,
      temperature: 0.1,
      maxTokens: 2048,
      contextSize: 12000,
      citationEnabled: true,
      memoryMode: "CONVERSATION",
    },
  });
  await prisma.botKnowledgeRack.upsert({
    where: {
      botId_rackId: { botId: defaultBot.id, rackId: generalRack.id },
    },
    update: {},
    create: { botId: defaultBot.id, rackId: generalRack.id },
  });
  for (const roleId of knowledgeRoleIds) {
    await prisma.botAccess.upsert({
      where: { botId_roleId: { botId: defaultBot.id, roleId } },
      update: { level: "USE" },
      create: {
        organizationId: organization.id,
        botId: defaultBot.id,
        roleId,
        level: "USE",
      },
    });
  }
  await prisma.botVersion.upsert({
    where: { botId_version: { botId: defaultBot.id, version: 1 } },
    update: {},
    create: {
      botId: defaultBot.id,
      version: 1,
      createdById: user.id,
      configuration: {
        seeded: true,
        citationEnabled: true,
        rackIds: [generalRack.id],
        roleIds: knowledgeRoleIds,
      },
    },
  });
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.SEED_DEVELOPMENT_TEST_USERS === "true"
  ) {
    const developmentPassword = process.env.DEVELOPMENT_TEST_USER_PASSWORD;
    if (!developmentPassword || developmentPassword.length < 12)
      throw new Error(
        "DEVELOPMENT_TEST_USER_PASSWORD is required when SEED_DEVELOPMENT_TEST_USERS=true.",
      );
    const testUsers = [
      ["DATA_SOURCE_MANAGER", "Development Data Manager", "datasource.manager"],
      [
        "DASHBOARD_BUILDER",
        "Development Dashboard Builder",
        "dashboard.builder",
      ],
      ["DASHBOARD_VIEWER", "Development Dashboard Viewer", "dashboard.viewer"],
      ["MANAGER", "ผู้จัดการ Pilot / Pilot Manager", "pilot.manager"],
      ["USER", "ผู้ใช้ Pilot / Pilot User", "pilot.user"],
    ] as const;
    for (const [systemKey, name, username] of testUsers) {
      const roleId = rolesByKey.get(systemKey);
      if (!roleId) continue;
      const testUser = await prisma.user.upsert({
        where: { email: `${username}@ai-dashboard.local` },
        update: { status: "ACTIVE", deletedAt: null },
        create: {
          name,
          username,
          email: `${username}@ai-dashboard.local`,
          status: "ACTIVE",
          passwordHash: await hash(developmentPassword, {
            algorithm: 2,
            memoryCost: 19456,
            timeCost: 2,
          }),
        },
      });
      const member = await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: testUser.id,
          },
        },
        update: {
          role: "VIEWER",
          organizationUnitId: generalUnit.id,
        },
        create: {
          organizationId: organization.id,
          userId: testUser.id,
          role: "VIEWER",
          organizationUnitId: generalUnit.id,
        },
      });
      await prisma.userProject.upsert({
        where: {
          organizationMemberId_projectId: {
            organizationMemberId: member.id,
            projectId: generalProject.id,
          },
        },
        update: {},
        create: {
          organizationMemberId: member.id,
          projectId: generalProject.id,
        },
      });
      await prisma.userRole.upsert({
        where: {
          organizationId_userId_roleId: {
            organizationId: organization.id,
            userId: testUser.id,
            roleId,
          },
        },
        update: {},
        create: {
          organizationId: organization.id,
          userId: testUser.id,
          roleId,
        },
      });
      await prisma.aIAccessPolicy.upsert({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: testUser.id,
          },
        },
        update: { copilotEnabled: systemKey !== "DATA_SOURCE_MANAGER" },
        create: {
          organizationId: organization.id,
          userId: testUser.id,
          copilotEnabled: systemKey !== "DATA_SOURCE_MANAGER",
        },
      });
    }
  }
  let dataSource = await prisma.dataSource.findFirst({
    where: {
      workspaceId: workspace.id,
      name: "Reporting PostgreSQL (planned)",
    },
  });
  dataSource ??= await prisma.dataSource.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: "Reporting PostgreSQL (planned)",
      type: "POSTGRESQL",
      status: "DRAFT",
      host: "postgres.example.invalid",
      port: 5432,
      databaseName: "reporting",
      username: "readonly_demo",
    },
  });
  let dashboard = await prisma.dashboard.findFirst({
    where: { workspaceId: workspace.id, name: "Executive Revenue Overview" },
  });
  dashboard ??= await prisma.dashboard.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: "Executive Revenue Overview",
      businessArea: "Revenue operations",
      businessObjective:
        "Monitor revenue performance, pipeline coverage, and forecast risk across operating regions.",
      desiredKpis: "Revenue, pipeline coverage, forecast accuracy, win rate",
      targetUsers: "Executive leadership",
      dataSources: { create: { dataSourceId: dataSource.id } },
      versions: {
        create: {
          version: 1,
          createdById: user.id,
          snapshot: { phase: 0, seeded: true, status: "DRAFT" },
        },
      },
    },
  });

  let showcase = await prisma.dashboard.findFirst({
    where: {
      workspaceId: workspace.id,
      name: "Visual Analytics Showcase",
    },
  });
  showcase ??= await prisma.dashboard.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: "Visual Analytics Showcase",
      status: "GENERATED",
      businessArea: "Inventory and Procurement",
      businessObjective:
        "Monitor purchasing spend, stock health, supplier performance, and order flow across warehouses.",
      businessQuestions:
        "Is procurement spend on target? Which categories and suppliers create risk? Where are purchase orders delayed?",
      desiredKpis:
        "Procurement spend, target achievement, stock health, purchase-order conversion, supplier performance",
      targetUsers: "Operations leadership and procurement managers",
      reportingPeriod: "Monthly",
      importantFilters: "Date range, warehouse, item category",
      layoutStyle: "EXECUTIVE_OVERVIEW",
      visualStyle: "MODERN_ENTERPRISE",
      visualTheme: "BLUE",
      dataSources: { create: { dataSourceId: dataSource.id } },
    },
  });
  await prisma.dashboard.update({
    where: { id: showcase.id },
    data: { status: "GENERATED" },
  });
  await prisma.dashboardVersion.upsert({
    where: {
      dashboardId_version: { dashboardId: showcase.id, version: 1 },
    },
    update: {},
    create: {
      dashboardId: showcase.id,
      version: 1,
      createdById: user.id,
      snapshot: {
        version: 1,
        seeded: true,
        purpose: "Rich dashboard renderer demonstration",
      },
    },
  });
  const dashboardFilters = [
    {
      id: "date_range",
      label: "Date range",
      control: "DATE_RANGE" as const,
      field: "period",
    },
    {
      id: "warehouse",
      label: "Warehouse",
      control: "SELECT" as const,
      field: "warehouse",
    },
  ];
  const sampleWidgets = [
    {
      type: "KPI" as const,
      title: "Procurement spend",
      definition: {
        id: "procurement_spend",
        type: "KPI",
        title: "Procurement spend",
        description: "Current spend with prior-period and target context.",
        businessQuestion: "Is procurement spend within the approved target?",
        visualizationReason:
          "A target-aware KPI communicates the headline position and trend.",
        priority: "HIGH",
        queryDefinitionId: "sample-spend",
        layout: { x: 0, y: 0, width: 3, height: 3 },
        visualization: {
          valueField: "spend",
          previousValueField: "previous_spend",
          targetField: "target",
          xField: "period",
          showLegend: false,
          palette: "BLUE",
        },
        dataMapping: { dimensions: ["period"], measures: ["spend"] },
        formatting: {
          displayFormat: "CURRENCY",
          decimals: 0,
          currency: "THB",
          compact: true,
        },
        filters: dashboardFilters,
        interaction: { crossFilter: true, drillDown: true, export: true },
        emptyStateMessage: "No procurement spend for this selection.",
      },
      rows: [
        {
          period: "2026-06-01",
          warehouse: "Bangkok",
          spend: 12500000,
          previous_spend: 10800000,
          target: 12000000,
        },
        {
          period: "2026-05-01",
          warehouse: "Bangkok",
          spend: 10800000,
          previous_spend: 9900000,
          target: 12000000,
        },
        {
          period: "2026-04-01",
          warehouse: "Bangkok",
          spend: 9900000,
          previous_spend: 9400000,
          target: 12000000,
        },
      ],
    },
    {
      type: "GAUGE" as const,
      title: "On-time delivery",
      definition: {
        id: "on_time_delivery",
        type: "GAUGE",
        title: "On-time delivery",
        description: "Supplier deliveries received by the promised date.",
        businessQuestion: "Are suppliers meeting the on-time delivery target?",
        visualizationReason:
          "A gauge is appropriate because a real 95% target exists.",
        priority: "HIGH",
        queryDefinitionId: "sample-delivery",
        layout: { x: 3, y: 0, width: 3, height: 3 },
        visualization: {
          valueField: "rate",
          targetField: "target",
          showLegend: false,
          palette: "EMERALD",
        },
        dataMapping: { dimensions: [], measures: ["rate", "target"] },
        formatting: {
          displayFormat: "PERCENTAGE",
          decimals: 1,
          compact: false,
        },
        interaction: { crossFilter: false, drillDown: true, export: true },
        emptyStateMessage: "No delivery performance data.",
      },
      rows: [{ rate: 92.4, target: 95 }],
    },
    {
      type: "LINE_CHART" as const,
      title: "Monthly spend trend",
      definition: {
        id: "monthly_spend_trend",
        type: "LINE_CHART",
        title: "Monthly spend trend",
        description: "Procurement spend across the last six months.",
        businessQuestion: "How is procurement spend changing over time?",
        visualizationReason:
          "Ordered monthly observations require trend analysis.",
        priority: "PRIMARY",
        queryDefinitionId: "sample-trend",
        layout: { x: 0, y: 3, width: 8, height: 5 },
        visualization: {
          xField: "period",
          yField: "spend",
          valueField: "spend",
          showLegend: false,
          palette: "BLUE",
        },
        dataMapping: { dimensions: ["period"], measures: ["spend"] },
        formatting: {
          displayFormat: "CURRENCY",
          decimals: 0,
          currency: "THB",
          compact: true,
        },
        filters: dashboardFilters,
        interaction: { crossFilter: true, drillDown: true, export: true },
        emptyStateMessage: "No spend trend for this selection.",
      },
      rows: [
        { period: "2026-01-01", warehouse: "Bangkok", spend: 8200000 },
        { period: "2026-02-01", warehouse: "Bangkok", spend: 8800000 },
        { period: "2026-03-01", warehouse: "Bangkok", spend: 9100000 },
        { period: "2026-04-01", warehouse: "Bangkok", spend: 9900000 },
        { period: "2026-05-01", warehouse: "Bangkok", spend: 10800000 },
        { period: "2026-06-01", warehouse: "Bangkok", spend: 12500000 },
        { period: "2026-01-01", warehouse: "Rayong", spend: 6100000 },
        { period: "2026-02-01", warehouse: "Rayong", spend: 5900000 },
        { period: "2026-03-01", warehouse: "Rayong", spend: 6700000 },
        { period: "2026-04-01", warehouse: "Rayong", spend: 7200000 },
        { period: "2026-05-01", warehouse: "Rayong", spend: 7600000 },
        { period: "2026-06-01", warehouse: "Rayong", spend: 8100000 },
      ],
    },
    {
      type: "DONUT_CHART" as const,
      title: "Spend by category",
      definition: {
        id: "spend_by_category",
        type: "DONUT_CHART",
        title: "Spend by category",
        description: "Share of procurement spend across five categories.",
        businessQuestion: "Which categories account for procurement spend?",
        visualizationReason:
          "Five non-negative categories support part-to-whole comparison.",
        priority: "MEDIUM",
        queryDefinitionId: "sample-category",
        layout: { x: 8, y: 3, width: 4, height: 5 },
        visualization: {
          categoryField: "category",
          valueField: "spend",
          showLegend: true,
          palette: "BLUE",
        },
        dataMapping: { dimensions: ["category"], measures: ["spend"] },
        formatting: {
          displayFormat: "CURRENCY",
          decimals: 0,
          currency: "THB",
          compact: true,
        },
        interaction: { crossFilter: true, drillDown: true, export: true },
        emptyStateMessage: "No category mix data.",
      },
      rows: [
        { category: "Raw materials", spend: 14200000 },
        { category: "Packaging", spend: 6900000 },
        { category: "MRO", spend: 4800000 },
        { category: "Logistics", spend: 3900000 },
        { category: "Services", spend: 2700000 },
      ],
    },
    {
      type: "HORIZONTAL_BAR_CHART" as const,
      title: "Supplier performance",
      definition: {
        id: "supplier_performance",
        type: "HORIZONTAL_BAR_CHART",
        title: "Supplier performance",
        description: "Top suppliers ranked by performance score.",
        businessQuestion: "Which suppliers perform best?",
        visualizationReason:
          "A ranked horizontal bar keeps supplier names readable.",
        priority: "MEDIUM",
        queryDefinitionId: "sample-supplier",
        layout: { x: 0, y: 8, width: 6, height: 4 },
        visualization: {
          categoryField: "supplier",
          valueField: "score",
          showLegend: false,
          palette: "EMERALD",
        },
        dataMapping: { dimensions: ["supplier"], measures: ["score"] },
        formatting: {
          displayFormat: "NUMBER",
          decimals: 1,
          compact: false,
          suffix: "/100",
        },
        interaction: { crossFilter: false, drillDown: true, export: true },
        emptyStateMessage: "No supplier performance data.",
      },
      rows: [
        { supplier: "Siam Industrial", score: 96 },
        { supplier: "Eastern Components", score: 91 },
        { supplier: "Metro Packaging", score: 88 },
        { supplier: "Thai MRO Supply", score: 84 },
        { supplier: "Pacific Logistics", score: 79 },
      ],
    },
    {
      type: "FUNNEL_CHART" as const,
      title: "Purchase-order flow",
      definition: {
        id: "purchase_order_flow",
        type: "FUNNEL_CHART",
        title: "Purchase-order flow",
        description: "Conversion from requisitions to received orders.",
        businessQuestion: "Where do purchase orders stall in the process?",
        visualizationReason:
          "Ordered process stages require a conversion funnel.",
        priority: "MEDIUM",
        queryDefinitionId: "sample-funnel",
        layout: { x: 6, y: 8, width: 6, height: 4 },
        visualization: {
          stageField: "stage",
          valueField: "orders",
          showLegend: false,
          palette: "BLUE",
        },
        dataMapping: { dimensions: ["stage"], measures: ["orders"] },
        formatting: { displayFormat: "NUMBER", decimals: 0, compact: true },
        interaction: { crossFilter: true, drillDown: true, export: true },
        emptyStateMessage: "No purchase-order stage data.",
      },
      rows: [
        { stage: "Requisition", orders: 1240 },
        { stage: "Approved", orders: 1080 },
        { stage: "Ordered", orders: 960 },
        { stage: "Shipped", orders: 840 },
        { stage: "Received", orders: 790 },
      ],
    },
    {
      type: "WATERFALL_CHART" as const,
      title: "Spend variance drivers",
      definition: {
        id: "spend_variance",
        type: "WATERFALL_CHART",
        title: "Spend variance drivers",
        description: "Positive and negative contributions to spend variance.",
        businessQuestion: "What is driving the change in procurement spend?",
        visualizationReason:
          "Signed contributions are best explained by a waterfall.",
        priority: "MEDIUM",
        queryDefinitionId: "sample-waterfall",
        layout: { x: 0, y: 12, width: 7, height: 4 },
        visualization: {
          categoryField: "driver",
          valueField: "variance",
          showLegend: false,
          palette: "SLATE",
        },
        dataMapping: { dimensions: ["driver"], measures: ["variance"] },
        formatting: {
          displayFormat: "CURRENCY",
          decimals: 0,
          currency: "THB",
          compact: true,
        },
        interaction: { crossFilter: false, drillDown: true, export: true },
        emptyStateMessage: "No spend variance drivers.",
      },
      rows: [
        { driver: "Volume", variance: 1600000 },
        { driver: "Price", variance: 900000 },
        { driver: "FX", variance: 350000 },
        { driver: "Savings", variance: -720000 },
        { driver: "Logistics", variance: 280000 },
      ],
    },
    {
      type: "TIMELINE" as const,
      title: "Upcoming deliveries",
      definition: {
        id: "delivery_timeline",
        type: "TIMELINE",
        title: "Upcoming deliveries",
        description: "Scheduled inbound deliveries requiring attention.",
        businessQuestion: "Which important deliveries are approaching?",
        visualizationReason: "Scheduled events are clearest on a timeline.",
        priority: "MEDIUM",
        queryDefinitionId: "sample-timeline",
        layout: { x: 7, y: 12, width: 5, height: 4 },
        visualization: {
          categoryField: "delivery",
          startField: "start_date",
          endField: "end_date",
          showLegend: false,
          palette: "BLUE",
        },
        dataMapping: {
          dimensions: ["delivery", "start_date", "end_date"],
          measures: [],
        },
        formatting: { displayFormat: "TEXT", decimals: 0, compact: false },
        interaction: { crossFilter: false, drillDown: true, export: true },
        emptyStateMessage: "No upcoming deliveries.",
      },
      rows: [
        {
          delivery: "Steel coils · Siam Industrial",
          start_date: "2026-07-20",
          end_date: "2026-07-21",
        },
        {
          delivery: "Packaging film · Metro Packaging",
          start_date: "2026-07-23",
          end_date: "2026-07-24",
        },
        {
          delivery: "Bearings · Eastern Components",
          start_date: "2026-07-26",
          end_date: "2026-07-28",
        },
        {
          delivery: "Safety stock replenishment",
          start_date: "2026-07-30",
          end_date: "2026-08-02",
        },
      ],
    },
    {
      type: "TABLE" as const,
      title: "Low-stock exceptions",
      definition: {
        id: "low_stock_exceptions",
        type: "TABLE",
        title: "Low-stock exceptions",
        description: "Items below reorder level requiring inspection.",
        businessQuestion: "Which items require immediate replenishment?",
        visualizationReason:
          "Operational exceptions require record-level inspection.",
        priority: "HIGH",
        queryDefinitionId: "sample-exceptions",
        layout: { x: 0, y: 16, width: 12, height: 4 },
        visualization: {
          categoryField: "item",
          statusField: "status",
          showLegend: false,
          palette: "AMBER",
        },
        dataMapping: {
          dimensions: ["item", "warehouse", "status"],
          measures: ["on_hand", "reorder_level"],
        },
        formatting: { displayFormat: "NUMBER", decimals: 0, compact: false },
        interaction: { crossFilter: true, drillDown: true, export: true },
        emptyStateMessage: "No low-stock exceptions.",
      },
      rows: [
        {
          item: "Bearing 6205",
          warehouse: "Rayong",
          on_hand: 12,
          reorder_level: 40,
          status: "Critical",
        },
        {
          item: "Safety glove L",
          warehouse: "Bangkok",
          on_hand: 85,
          reorder_level: 120,
          status: "Warning",
        },
        {
          item: "Packaging film 40µ",
          warehouse: "Bangkok",
          on_hand: 18,
          reorder_level: 65,
          status: "Critical",
        },
      ],
    },
    {
      type: "AI_INSIGHT" as const,
      title: "AI business insight",
      definition: {
        id: "ai_business_insight",
        type: "AI_INSIGHT",
        title: "AI business insight",
        description:
          "Spend accelerated above target while supplier delivery remained below the 95% goal. Raw materials explain the largest share, and the order funnel loses 18% before ordering.",
        businessQuestion: "What should procurement leadership focus on now?",
        visualizationReason:
          "A separated narrative panel highlights grounded cross-widget findings.",
        priority: "HIGH",
        layout: { x: 0, y: 20, width: 12, height: 3 },
        visualization: { showLegend: false, palette: "BLUE" },
        dataMapping: { dimensions: [], measures: [] },
        formatting: { displayFormat: "TEXT", decimals: 0, compact: false },
        interaction: { crossFilter: false, drillDown: false, export: false },
        emptyStateMessage: "No grounded insight is available.",
      },
      rows: [{ insight: "Spend requires management attention." }],
    },
  ];
  await prisma.dashboardWidget.deleteMany({
    where: { dashboardId: showcase.id },
  });
  for (const [position, widget] of sampleWidgets.entries()) {
    await prisma.dashboardWidget.create({
      data: {
        dashboardId: showcase.id,
        type: widget.type,
        title: widget.title,
        position,
        config: {
          version: 2,
          definition: widget.definition,
          sampleRows: widget.rows,
          seeded: true,
        },
      },
    });
  }
  console.log(
    `Seeded initial administrator ${user.email}, workspace ${workspace.name}, dashboard ${dashboard.name}, and visual showcase ${showcase.name}.`,
  );
}

main().finally(() => prisma.$disconnect());
