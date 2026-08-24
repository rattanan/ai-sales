import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const assetDirectory =
  "/Users/rattananair/codes/ai-sales/docs/assets/ai-sales-ntop-executive";
const outputPath =
  "/Users/rattananair/codes/ai-sales/docs/AI-Sales-NTOP-Executive-Presentation.pptx";

const slides = [
  ["00-cover.png", "หน้าปก AI-Sales + NTOP"],
  ["01-problem.png", "ปัญหาของทีมขายในปัจจุบัน"],
  ["02-one-experience.png", "AI-Sales และ NTOP สร้างประสบการณ์เดียวกัน"],
  ["03-grounded-answer.png", "คำตอบจากข้อมูลที่เชื่อถือได้"],
  ["04-human-confirmation.png", "ผู้ใช้ยืนยันก่อนบันทึกข้อมูล"],
  ["05-sales-benefits.png", "ประโยชน์ต่อทีมขาย"],
  ["06-executive-benefits.png", "ประโยชน์ต่อผู้บริหาร"],
  ["07-trust-control.png", "ความปลอดภัยและการตรวจสอบย้อนหลัง"],
  ["08-pilot.png", "ข้อเสนอ Pilot 90 วัน"],
];

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

const presentation = Presentation.create({
  slideSize: { width: 1600, height: 900 },
});

for (const [fileName, alt] of slides) {
  const slide = presentation.slides.add();
  const sourcePath = `${assetDirectory}/${fileName}`;
  const bytes = await fs.readFile(sourcePath);

  slide.images.add({
    blob: toArrayBuffer(bytes),
    contentType: "image/png",
    alt,
    fit: "contain",
    position: { left: 0, top: 0, width: 1600, height: 900 },
  });

  slide.speakerNotes.textFrame.setText(
    `[Sources]\n- User-directed presentation visual and local system screenshots: ${sourcePath}`,
  );
  slide.speakerNotes.setVisible(true);
}

const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(outputPath);

