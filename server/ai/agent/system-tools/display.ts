import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  chatChartDatasetSchema,
  chatChartTypeSchema,
} from "@/schemas/chat-artifact";
import {
  defineAgentTool,
  toolFailure,
  toolSuccess,
  type AgentRunContext,
} from "@/server/ai/agent/types";
import {
  displayNumbersAreGrounded,
  displayTextIsGrounded,
} from "@/server/ai/display-artifacts/grounding";
import {
  DisplayImageError,
  fetchDisplayImage,
} from "@/server/ai/display-artifacts/image-fetch";
import {
  normalizeQrPayload,
  QrPayloadError,
  renderQrSvg,
} from "@/server/ai/display-artifacts/qr-renderer";
import {
  renderChartSvg,
  type ChartSpec,
} from "@/server/ai/display-artifacts/chart-renderer";

const MAX_ARTIFACTS_PER_TURN = 3;

function quotaAvailable(context: AgentRunContext) {
  return (context.displayArtifactCount ?? 0) < MAX_ARTIFACTS_PER_TURN;
}

function reserveArtifact(context: AgentRunContext) {
  context.displayArtifactCount = (context.displayArtifactCount ?? 0) + 1;
}

const qrParameters = z.object({
  data: z
    .string()
    .trim()
    .min(1)
    .max(1_024)
    .describe(
      "payload ที่ปรากฏอยู่จริงในข้อความผู้ใช้หรือผลลัพธ์เครื่องมือก่อนหน้า ต้องคัดลอกตรงตัว ห้ามเดาหรือแก้ตัวเลข",
    ),
  label: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe("หัวข้อสั้นเหนือ QR เช่น เลขที่ใบแจ้งหนี้"),
  caption: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe("คำอธิบายสั้นใต้ QR โดยห้ามใส่ข้อมูลลับเพิ่ม"),
});

const chartParameters = z
  .object({
    type: chatChartTypeSchema.describe(
      "bar = เปรียบเทียบ, line = แนวโน้ม, pie/doughnut = สัดส่วน",
    ),
    labels: z
      .array(z.string().trim().min(1).max(60))
      .min(1)
      .max(24)
      .describe("ชื่อหมวดหมู่หรือแกนเวลา สูงสุด 24 ค่า"),
    datasets: z
      .array(chatChartDatasetSchema)
      .min(1)
      .max(6)
      .describe(
        "ชุดข้อมูลที่ตัวเลขทุกค่าต้องมาจากข้อความหรือผลลัพธ์เครื่องมือก่อนหน้า",
      ),
    title: z.string().trim().max(120).optional().describe("ชื่อกราฟ"),
    horizontal: z
      .boolean()
      .optional()
      .describe("ใช้กับ bar เมื่อชื่อหมวดหมู่ยาว"),
    stacked: z.boolean().optional().describe("ใช้กับ bar เพื่อซ้อนชุดข้อมูล"),
    valueSuffix: z
      .string()
      .max(12)
      .optional()
      .describe('หน่วยต่อท้ายค่า เช่น " บาท" หรือ "%"'),
  })
  .superRefine((value, context) => {
    value.datasets.forEach((dataset, index) => {
      if (dataset.data.length !== value.labels.length)
        context.addIssue({
          code: "custom",
          path: ["datasets", index, "data"],
          message: "จำนวนข้อมูลต้องเท่ากับจำนวน labels ห้ามเติมค่าที่ไม่มีจริง",
        });
    });
    if (["pie", "doughnut"].includes(value.type)) {
      if (value.datasets.length !== 1)
        context.addIssue({
          code: "custom",
          path: ["datasets"],
          message: "pie/doughnut รองรับหนึ่งชุดข้อมูลเท่านั้น",
        });
      if (
        value.datasets.some((dataset) => dataset.data.some((item) => item < 0))
      )
        context.addIssue({
          code: "custom",
          path: ["datasets"],
          message: "pie/doughnut ไม่รองรับค่าติดลบ",
        });
      if (
        (value.datasets[0]?.data.reduce((sum, item) => sum + item, 0) ?? 0) <= 0
      )
        context.addIssue({
          code: "custom",
          path: ["datasets"],
          message: "pie/doughnut ต้องมีผลรวมมากกว่าศูนย์",
        });
    }
  });

const imageParameters = z.object({
  url: z
    .url()
    .max(2_048)
    .describe(
      "URL รูป HTTPS ที่ปรากฏตรงตัวในข้อความผู้ใช้หรือผลลัพธ์เครื่องมือก่อนหน้า ห้ามสร้าง URL เอง",
    ),
  alt: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("คำอธิบายรูปสำหรับผู้ใช้ screen reader"),
  caption: z.string().trim().max(300).optional().describe("คำบรรยายสั้นใต้รูป"),
});

export const displayQr = defineAgentTool({
  name: "display_qr",
  kind: "SYSTEM",
  access: "READ",
  group: "DISPLAY",
  traceRedacted: true,
  description:
    "แสดง QR code ในแชท ใช้เมื่อผู้ใช้ต้องสแกน URL หรือ payload ชำระเงินที่ปรากฏอยู่จริงในข้อความหรือผลลัพธ์เครื่องมือ " +
    "ต้องคัดลอก payload ตรงตัว ห้ามเดา ย่อ เรียงใหม่ หรือแก้เลขอ้างอิง เรียกเครื่องมือข้อมูลก่อนหากยังไม่มี payload " +
    "เมื่อการ์ดแสดงแล้วไม่ต้องพิมพ์ payload ซ้ำในคำตอบ",
  parameters: qrParameters,
  async execute(context, args) {
    if (!quotaAvailable(context))
      return toolFailure(
        "แสดงผลครบ 3 รายการในเทิร์นนี้แล้ว ให้สรุปจากรายการที่แสดงอยู่",
        "DISPLAY_ARTIFACT_LIMIT",
      );
    if (!displayTextIsGrounded(context.displayGroundingText, args.data))
      return toolFailure(
        "ไม่พบ QR payload นี้ในข้อความหรือผลลัพธ์เครื่องมือก่อนหน้า ห้ามสร้าง payload เอง",
        "DISPLAY_NOT_GROUNDED",
      );
    try {
      const payload = normalizeQrPayload(args.data);
      const artifact = {
        id: randomUUID(),
        kind: "qr" as const,
        svg: renderQrSvg(payload),
        label: args.label,
        caption: args.caption,
      };
      reserveArtifact(context);
      return toolSuccess(
        "แสดง QR code ในแชทแล้ว ให้ยืนยันสั้น ๆ โดยไม่พิมพ์ payload ซ้ำ",
        [],
        { artifacts: [artifact] },
      );
    } catch (error) {
      return toolFailure(
        error instanceof QrPayloadError
          ? error.message
          : "สร้าง QR code ไม่สำเร็จ",
        "DISPLAY_QR_INVALID",
      );
    }
  },
});

export const displayChart = defineAgentTool({
  name: "display_chart",
  kind: "SYSTEM",
  access: "READ",
  group: "DISPLAY",
  traceRedacted: true,
  description:
    "แสดงกราฟจากตัวเลขที่ปรากฏอยู่จริงในข้อความผู้ใช้หรือผลลัพธ์เครื่องมือก่อนหน้า " +
    "ใช้ line สำหรับแนวโน้ม bar สำหรับเปรียบเทียบ และ pie/doughnut สำหรับสัดส่วน " +
    "ห้ามประมาณ เติมศูนย์ หรือสร้างค่าที่ไม่มีหลักฐาน เมื่อแสดงแล้วให้สรุปข้อค้นพบแทนการไล่ตัวเลขซ้ำ",
  parameters: chartParameters,
  async execute(context, args) {
    if (!quotaAvailable(context))
      return toolFailure(
        "แสดงผลครบ 3 รายการในเทิร์นนี้แล้ว ให้สรุปจากรายการที่แสดงอยู่",
        "DISPLAY_ARTIFACT_LIMIT",
      );
    const values = args.datasets.flatMap((dataset) => dataset.data);
    const labels = [
      ...args.labels,
      ...args.datasets.flatMap((dataset) =>
        dataset.label ? [dataset.label] : [],
      ),
    ];
    if (
      !displayNumbersAreGrounded(context.displayGroundingText, values) ||
      labels.some(
        (label) => !displayTextIsGrounded(context.displayGroundingText, label),
      )
    )
      return toolFailure(
        "มีตัวเลขหรือชื่อหมวดหมู่ในกราฟที่ไม่พบในข้อความหรือผลลัพธ์เครื่องมือก่อนหน้า ห้ามเดาหรือเติมค่า",
        "DISPLAY_NOT_GROUNDED",
      );
    const spec: ChartSpec = args;
    const artifact = {
      id: randomUUID(),
      kind: "chart" as const,
      ...spec,
      svg: renderChartSvg(spec),
    };
    reserveArtifact(context);
    return toolSuccess(
      "แสดงกราฟในแชทแล้ว ให้สรุปสิ่งสำคัญหนึ่งหรือสองประโยค",
      [],
      { artifacts: [artifact] },
    );
  },
});

export const displayImage = defineAgentTool({
  name: "display_image",
  kind: "SYSTEM",
  access: "READ",
  group: "DISPLAY",
  traceRedacted: true,
  description:
    "แสดงรูป JPEG, PNG หรือ WebP จาก URL HTTPS ที่ปรากฏอยู่จริงในข้อความหรือผลลัพธ์เครื่องมือก่อนหน้า " +
    "เหมาะกับรูปสินค้า แผนผัง ภาพหน้าจอ หรือแผนที่ ห้ามเดาหรือประกอบ URL เอง และต้องใส่ alt ที่อธิบายรูป " +
    "ระบบจะดาวน์โหลดและตรวจความปลอดภัยก่อนแสดง จึงไม่ต้องวาง URL ซ้ำในคำตอบ",
  parameters: imageParameters,
  async execute(context, args) {
    if (!quotaAvailable(context))
      return toolFailure(
        "แสดงผลครบ 3 รายการในเทิร์นนี้แล้ว ให้สรุปจากรายการที่แสดงอยู่",
        "DISPLAY_ARTIFACT_LIMIT",
      );
    if (!displayTextIsGrounded(context.displayGroundingText, args.url))
      return toolFailure(
        "ไม่พบ URL รูปนี้ในข้อความหรือผลลัพธ์เครื่องมือก่อนหน้า ห้ามสร้าง URL เอง",
        "DISPLAY_NOT_GROUNDED",
      );
    try {
      const media = await fetchDisplayImage(args.url);
      reserveArtifact(context);
      return toolSuccess(
        "แสดงรูปในแชทแล้ว ให้กล่าวถึงรูปโดยไม่วาง URL ซ้ำ",
        [],
        {
          artifacts: [
            {
              id: randomUUID(),
              kind: "image",
              mediaBytes: media.bytes,
              mediaType: media.mediaType,
              alt: args.alt,
              caption: args.caption,
            },
          ],
        },
      );
    } catch (error) {
      return toolFailure(
        error instanceof DisplayImageError
          ? error.message
          : "ดาวน์โหลดรูปไม่สำเร็จ",
        error instanceof DisplayImageError
          ? `DISPLAY_IMAGE_${error.code}`
          : "DISPLAY_IMAGE_FETCH_FAILED",
      );
    }
  },
});

export const DISPLAY_SYSTEM_TOOLS = [
  displayQr,
  displayChart,
  displayImage,
] as const;
