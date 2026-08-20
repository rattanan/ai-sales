import { createHash } from "node:crypto";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  documentExtension,
  isSupportedDocument,
} from "./document-types";

export { documentExtension, isSupportedDocument } from "./document-types";

export const PARSER_VERSION = "insightkm-parser-v1";
export const CHUNKING_VERSION = "insightkm-chunker-v1";

export type ParsedSection = {
  text: string;
  metadata: Record<string, string | number>;
};

export type ParsedDocument = {
  sections: ParsedSection[];
  parserVersion: typeof PARSER_VERSION;
};

export function estimateEmbeddingTokens(value: string) {
  let asciiCharacters = 0;
  let nonAsciiCharacters = 0;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x7f) asciiCharacters += 1;
    else nonAsciiCharacters += 1;
  }
  return Math.max(
    1,
    asciiCharacters + nonAsciiCharacters * 2,
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlText(value: string) {
  return normalizeText(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function textSections(text: string, metadata: ParsedSection["metadata"] = {}) {
  return normalizeText(text)
    .split(/\n\s*\n/)
    .map(normalizeText)
    .filter(Boolean)
    .map((section, index) => ({
      text: section,
      metadata: { ...metadata, section: index + 1 },
    }));
}

export async function parseDocument(
  bytes: Buffer,
  fileName: string,
): Promise<ParsedDocument> {
  const extension = documentExtension(fileName);
  if (!isSupportedDocument(fileName))
    throw new Error("Unsupported document type");
  let sections: ParsedSection[] = [];
  if (["txt", "md", "markdown"].includes(extension)) {
    sections = textSections(bytes.toString("utf8"));
  } else if (["html", "htm"].includes(extension)) {
    sections = textSections(htmlText(bytes.toString("utf8")));
  } else if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer: bytes });
    sections = textSections(result.value);
  } else if (extension === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      sections = result.pages.flatMap((page) =>
        textSections(page.text, { page: page.num }),
      );
    } finally {
      await parser.destroy();
    }
  } else {
    const workbook = XLSX.read(bytes, {
      type: "buffer",
      dense: true,
      cellDates: true,
    });
    sections = workbook.SheetNames.flatMap((sheetName) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[sheetName],
        { header: 1, raw: false, blankrows: false },
      );
      return rows.flatMap((row, index) => {
        const text = normalizeText(
          row
            .map((cell) => String(cell ?? "").trim())
            .filter(Boolean)
            .join(" | "),
        );
        return text
          ? [{ text, metadata: { sheet: sheetName, row: index + 1 } }]
          : [];
      });
    });
  }
  if (!sections.length) throw new Error("No extractable text was found");
  return { sections, parserVersion: PARSER_VERSION };
}

export function chunkParsedDocument(
  parsed: ParsedDocument,
  options: {
    maxCharacters: number;
    overlapCharacters: number;
    maxTokens?: number;
  },
) {
  const chunks: Array<{
    ordinal: number;
    content: string;
    contentHash: string;
    tokenCount: number;
    metadata: ParsedSection["metadata"];
  }> = [];
  const seen = new Set<string>();
  for (const section of parsed.sections) {
    let cursor = 0;
    while (cursor < section.text.length) {
      let end = Math.min(cursor + options.maxCharacters, section.text.length);
      if (
        options.maxTokens &&
        estimateEmbeddingTokens(section.text.slice(cursor, end)) >
          options.maxTokens
      ) {
        let low = cursor + 1;
        let high = end;
        while (low < high) {
          const midpoint = Math.ceil((low + high) / 2);
          if (
            estimateEmbeddingTokens(section.text.slice(cursor, midpoint)) <=
            options.maxTokens
          )
            low = midpoint;
          else high = midpoint - 1;
        }
        end = low;
      }
      if (end < section.text.length) {
        const boundary = Math.max(
          section.text.lastIndexOf("\n", end),
          section.text.lastIndexOf(". ", end),
          section.text.lastIndexOf("。", end),
          section.text.lastIndexOf(" ", end),
        );
        if (boundary > cursor + (end - cursor) * 0.6) end = boundary + 1;
      }
      const content = normalizeText(section.text.slice(cursor, end));
      const contentHash = createHash("sha256").update(content).digest("hex");
      if (content && !seen.has(contentHash)) {
        seen.add(contentHash);
        chunks.push({
          ordinal: chunks.length,
          content,
          contentHash,
          tokenCount: estimateEmbeddingTokens(content),
          metadata: section.metadata,
        });
      }
      if (end >= section.text.length) break;
      const overlap = Math.min(
        options.overlapCharacters,
        Math.floor((end - cursor) * 0.2),
      );
      cursor = Math.max(cursor + 1, end - overlap);
    }
  }
  return chunks;
}
