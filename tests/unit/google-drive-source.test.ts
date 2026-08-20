import { describe, expect, it, vi } from "vitest";
import {
  downloadGoogleDriveFile,
  scanGoogleDriveFolder,
} from "@/packages/knowledge/google-drive";
import {
  canonicalGoogleDriveFolderUrl,
  googleDriveFolderId,
  googleDriveServiceAccountEmail,
} from "@/packages/knowledge/google-drive-url";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Google Drive shared-folder ingestion", () => {
  it("accepts only canonical Google Drive folder URLs", () => {
    expect(
      googleDriveFolderId(
        "https://drive.google.com/drive/u/0/folders/abc_DEF-123?usp=sharing",
      ),
    ).toBe("abc_DEF-123");
    expect(
      canonicalGoogleDriveFolderUrl(
        "https://drive.google.com/drive/folders/abc_DEF-123?usp=sharing",
      ),
    ).toBe("https://drive.google.com/drive/folders/abc_DEF-123");
    expect(
      googleDriveFolderId("https://example.com/drive/folders/abc_DEF-123"),
    ).toBeNull();
  });

  it("reads the service-account email from raw or base64 JSON", () => {
    const credentials = JSON.stringify({
      client_email: "insightkm@example.iam.gserviceaccount.com",
    });
    expect(googleDriveServiceAccountEmail(credentials)).toBe(
      "insightkm@example.iam.gserviceaccount.com",
    );
    expect(
      googleDriveServiceAccountEmail(
        Buffer.from(credentials).toString("base64"),
      ),
    ).toBe("insightkm@example.iam.gserviceaccount.com");
  });

  it("lists supported files recursively and maps Workspace exports", async () => {
    const fetcher = vi.fn(async (request: string | URL | Request) => {
      const url = new URL(String(request));
      if (url.pathname.endsWith("/root-folder"))
        return jsonResponse({
          id: "root-folder",
          name: "Policies",
          mimeType: "application/vnd.google-apps.folder",
        });
      const query = url.searchParams.get("q") ?? "";
      if (query.includes("'root-folder'"))
        return jsonResponse({
          files: [
            {
              id: "doc-1",
              name: "Employee handbook",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: "2026-08-20T06:00:00.000Z",
              version: "4",
              capabilities: { canDownload: true },
            },
            {
              id: "folder-2",
              name: "Benefits",
              mimeType: "application/vnd.google-apps.folder",
            },
            {
              id: "image-1",
              name: "photo.png",
              mimeType: "image/png",
            },
          ],
        });
      return jsonResponse({
        files: [
          {
            id: "pdf-1",
            name: "Insurance.pdf",
            mimeType: "application/pdf",
            size: "128",
            modifiedTime: "2026-08-20T07:00:00.000Z",
            md5Checksum: "abc",
            capabilities: { canDownload: true },
          },
        ],
      });
    });

    const result = await scanGoogleDriveFolder({
      folderUrl: "https://drive.google.com/drive/folders/root-folder",
      accessToken: "token",
      includeSubdirectories: true,
      maxFiles: 10,
      maxFileBytes: 1_000,
      fetcher: fetcher as typeof fetch,
    });

    expect(result.files).toEqual([
      expect.objectContaining({
        locator: "gdrive:doc-1",
        relativePath: "Employee handbook.docx",
        exportMimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      expect.objectContaining({
        locator: "gdrive:pdf-1",
        relativePath: "Benefits/Insurance.pdf",
        exportMimeType: null,
      }),
    ]);
  });

  it("downloads exported content with a strict size limit", async () => {
    const bytes = Buffer.from("document content");
    const result = await downloadGoogleDriveFile({
      file: {
        locator: "gdrive:doc-1",
        fileId: "doc-1",
        name: "Handbook.docx",
        relativePath: "Handbook.docx",
        originalMimeType: "application/vnd.google-apps.document",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        exportMimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: null,
        modifiedAt: null,
        checksum: "drive:1:now",
        webViewLink: null,
      },
      accessToken: "token",
      maxFileBytes: 1_000,
      fetcher: vi.fn(async () => new Response(bytes)) as typeof fetch,
    });

    expect(result.bytes).toEqual(bytes);
    expect(result.checksum).toMatch(/^sha256:/);
  });
});
