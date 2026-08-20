import * as XLSX from "xlsx";
import path from "node:path";
import { failure, success } from "@/types/result";
import type { ObjectStorageService } from "@/server/storage/object-storage";

const EXTENSION = /\.xlsx$/i;
const MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

export type ImportedExcelSheet = {
  name: string;
  columns: {
    name: string;
    dataType: string;
    ordinal: number;
    nullable: boolean;
  }[];
  rows: Record<string, string | number | boolean | null>[];
};

export type UploadedWorkbook = {
  key: string;
  size: number;
  checksum: string;
  originalName: string;
  mimeType: string;
  sheetNames: string[];
  sheets: ImportedExcelSheet[];
  rowCount: number;
};

function jsonValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return String(value).slice(0, 10_000);
}

function inferType(values: (string | number | boolean | null)[]) {
  const present = values.filter((value) => value !== null);
  if (!present.length) return "string";
  if (present.every((value) => typeof value === "boolean")) return "boolean";
  if (present.every((value) => typeof value === "number")) return "number";
  if (
    present.every(
      (value) =>
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) &&
        !Number.isNaN(Date.parse(value)),
    )
  )
    return "date";
  return "string";
}

export class ExcelUploadService {
  constructor(
    private readonly storage: ObjectStorageService,
    private readonly maxBytes = 10_485_760,
    private readonly maxRows = 100_000,
    private readonly maxSheets = 50,
  ) {}

  async upload(file: File) {
    if (
      !EXTENSION.test(file.name) ||
      path.basename(file.name) !== file.name ||
      file.name.length > 180 ||
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(file.name) ||
      !MIME_TYPES.has(file.type || "application/octet-stream")
    )
      return failure("FILE_INVALID", "Choose an .xlsx workbook.");
    if (file.size <= 0 || file.size > this.maxBytes)
      return failure(
        "FILE_INVALID",
        `Workbook size must be between 1 byte and ${this.maxBytes} bytes.`,
      );
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        return failure(
          "FILE_INVALID",
          "The file is not a valid .xlsx archive.",
        );
      const workbook = XLSX.read(bytes, {
        type: "buffer",
        cellFormula: false,
        cellHTML: false,
        cellText: false,
        cellDates: true,
      });
      if (!workbook.SheetNames.length)
        return failure(
          "FILE_INVALID",
          "The workbook does not contain any sheets.",
        );
      if (workbook.SheetNames.length > this.maxSheets)
        return failure(
          "FILE_INVALID",
          `The workbook contains more than ${this.maxSheets} sheets.`,
        );
      let importedRows = 0;
      const sheets: ImportedExcelSheet[] = workbook.SheetNames.map((name) => {
        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(
          workbook.Sheets[name],
          { header: 1, raw: true, defval: null, blankrows: false },
        );
        const rawHeaders = rawRows.shift() ?? [];
        const used = new Set<string>();
        const headers = rawHeaders.map((value, index) => {
          const base = String(value ?? "").trim() || `Column_${index + 1}`;
          let candidate = base;
          let suffix = 2;
          while (used.has(candidate.toLowerCase()))
            candidate = `${base}_${suffix++}`;
          used.add(candidate.toLowerCase());
          return candidate;
        });
        const rows = rawRows.map((row) =>
          Object.fromEntries(
            headers.map((header, index) => [header, jsonValue(row[index])]),
          ),
        );
        importedRows += rows.length;
        return {
          name,
          rows,
          columns: headers.map((columnName, ordinal) => {
            const values = rows.slice(0, 1_000).map((row) => row[columnName]);
            return {
              name: columnName,
              dataType: inferType(values),
              ordinal: ordinal + 1,
              nullable: values.some((value) => value === null),
            };
          }),
        };
      });
      if (importedRows > this.maxRows)
        return failure(
          "FILE_INVALID",
          `The workbook contains more than ${this.maxRows.toLocaleString()} data rows.`,
        );
      const stored = await this.storage.put({ bytes, originalName: file.name });
      return success({
        ...stored,
        originalName: file.name,
        mimeType: file.type,
        sheetNames: workbook.SheetNames,
        sheets,
        rowCount: importedRows,
      });
    } catch {
      return failure(
        "FILE_INVALID",
        "The workbook could not be read. It may be damaged or password protected.",
      );
    }
  }
}
