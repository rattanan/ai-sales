import path from "node:path";

const MIME_BY_EXTENSION: Record<string, Set<string>> = {
  pdf: new Set(["application/pdf", "application/octet-stream", ""]),
  docx: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
    "",
  ]),
  xlsx: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
    "",
  ]),
  csv: new Set(["text/csv", "text/plain", "application/octet-stream", ""]),
  txt: new Set(["text/plain", "application/octet-stream", ""]),
  md: new Set(["text/markdown", "text/plain", "application/octet-stream", ""]),
  markdown: new Set([
    "text/markdown",
    "text/plain",
    "application/octet-stream",
    "",
  ]),
  html: new Set(["text/html", "application/octet-stream", ""]),
  htm: new Set(["text/html", "application/octet-stream", ""]),
};

export function validKnowledgeUploadIdentity(
  fileName: string,
  mimeType: string,
) {
  const normalized = fileName.normalize("NFKC");
  const extension = normalized.split(".").pop()?.toLowerCase() ?? "";
  return (
    normalized.length >= 1 &&
    normalized.length <= 180 &&
    path.basename(normalized) === normalized &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(normalized) &&
    !normalized.startsWith(".") &&
    Boolean(MIME_BY_EXTENSION[extension]?.has(mimeType.toLowerCase()))
  );
}

export function validKnowledgeUploadMagic(bytes: Buffer, fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return bytes.subarray(0, 4).toString() === "%PDF";
  if (["docx", "xlsx"].includes(extension ?? ""))
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  return !bytes.subarray(0, 512).includes(0);
}
