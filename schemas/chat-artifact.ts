import { z } from "zod";

export const chatChartTypeSchema = z.enum(["bar", "line", "pie", "doughnut"]);

export const chatChartDatasetSchema = z.object({
  label: z.string().max(60).optional(),
  data: z.array(z.number().finite()).min(1).max(24),
});

function serverAuthoredSvgSchema(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine(
      (value) =>
        value.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') &&
        !/<(?:script|foreignObject|iframe|object|embed)\b/i.test(value) &&
        !/\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=/i.test(value),
      "Only server-authored standalone SVG is accepted",
    );
}

export const storedQrArtifactPayloadSchema = z.object({
  svg: serverAuthoredSvgSchema(250_000),
  label: z.string().max(120).optional(),
  caption: z.string().max(300).optional(),
});

export const storedChartArtifactPayloadSchema = z
  .object({
    svg: serverAuthoredSvgSchema(500_000),
    type: chatChartTypeSchema,
    labels: z.array(z.string().max(60)).min(1).max(24),
    datasets: z.array(chatChartDatasetSchema).min(1).max(6),
    title: z.string().max(120).optional(),
    horizontal: z.boolean().optional(),
    stacked: z.boolean().optional(),
    valueSuffix: z.string().max(12).optional(),
  })
  .superRefine((value, context) => {
    value.datasets.forEach((dataset, index) => {
      if (dataset.data.length !== value.labels.length)
        context.addIssue({
          code: "custom",
          path: ["datasets", index, "data"],
          message: "Chart data and label counts must match",
        });
    });
  });

export const storedImageArtifactPayloadSchema = z.object({
  alt: z.string().min(1).max(200),
  caption: z.string().max(300).optional(),
});
