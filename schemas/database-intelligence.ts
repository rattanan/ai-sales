import { z } from "zod";

export const databaseQuestionInputSchema = z.object({
  dataSourceId: z.string().min(1),
  question: z.string().trim().min(3).max(2_000),
  botId: z.string().min(1).optional(),
});

export const databaseQueryIdSchema = z.object({ id: z.string().min(1) });

export const databaseQueryPlanSchema = z
  .object({
    intent: z.enum(["DATABASE", "CLARIFICATION"]),
    clarification: z.string().trim().min(3).max(1_000).nullable(),
    sql: z.string().trim().min(1).max(100_000).nullable(),
    explanation: z.string().trim().min(1).max(2_000),
    referencedTables: z.array(z.string().regex(/^[^.]+\.[^.]+$/)).max(20),
  })
  .superRefine((value, context) => {
    if (value.intent === "CLARIFICATION" && !value.clarification)
      context.addIssue({
        code: "custom",
        path: ["clarification"],
        message: "Clarification is required",
      });
    if (value.intent === "DATABASE" && !value.sql)
      context.addIssue({
        code: "custom",
        path: ["sql"],
        message: "SQL is required",
      });
  });

export const databaseAnswerSummarySchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  limitations: z.array(z.string().trim().min(1).max(500)).max(10),
});

export const metadataDescriptionOutputSchema = z.object({
  tables: z
    .array(
      z.object({
        table: z.string().regex(/^[^.]+\.[^.]+$/),
        description: z.string().trim().min(1).max(1_500),
        columns: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(255),
              description: z.string().trim().min(1).max(1_000),
            }),
          )
          .max(200),
      }),
    )
    .max(100),
});

export const databaseScopeSchema = z.object({
  dataSourceId: z.string().min(1),
  sampleDataEnabled: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
  selectedTableIds: z.array(z.string().min(1)).max(500),
  sampleTableIds: z.array(z.string().min(1)).max(100),
});

export type DatabaseQueryPlan = z.infer<typeof databaseQueryPlanSchema>;
