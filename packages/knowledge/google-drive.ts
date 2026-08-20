import { createHash } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { documentExtension, isSupportedDocument } from "./document-types.js";
import {
  googleDriveCredentials,
  googleDriveFolderId,
} from "./google-drive-url.js";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

type DriveApiFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  version?: string;
  webViewLink?: string;
  capabilities?: { canDownload?: boolean };
};

type DriveFileList = {
  files?: DriveApiFile[];
  nextPageToken?: string;
};

type GoogleDriveFetch = typeof fetch;

export type GoogleDriveSnapshotInput = {
  locator: string;
  fileId: string;
  name: string;
  relativePath: string;
  originalMimeType: string;
  mimeType: string;
  exportMimeType: string | null;
  size: number | null;
  modifiedAt: Date | null;
  checksum: string;
  webViewLink: string | null;
};

const workspaceExports: Record<
  string,
  { extension: string; mimeType: string }
> = {
  "application/vnd.google-apps.document": {
    extension: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  "application/vnd.google-apps.spreadsheet": {
    extension: "xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  "application/vnd.google-apps.presentation": {
    extension: "pdf",
    mimeType: "application/pdf",
  },
  "application/vnd.google-apps.drawing": {
    extension: "pdf",
    mimeType: "application/pdf",
  },
};

function apiErrorMessage(status: number, payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  )
    return payload.error.message;
  return `Google Drive returned HTTP ${status}.`;
}

async function driveJson<T>(
  url: URL,
  accessToken: string,
  fetcher: GoogleDriveFetch,
) {
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload));
  return payload as T;
}

function safeDriveName(name: string) {
  return name.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "Untitled";
}

function exportedName(name: string, extension: string) {
  const safeName = safeDriveName(name);
  return documentExtension(safeName) === extension
    ? safeName
    : `${safeName}.${extension}`;
}

function normalizedDriveFile(
  file: DriveApiFile,
  parentPath: string,
): GoogleDriveSnapshotInput | null {
  if (!file.id || !file.name || !file.mimeType) return null;
  const exported = workspaceExports[file.mimeType];
  const name = exported
    ? exportedName(file.name, exported.extension)
    : safeDriveName(file.name);
  if (!exported && !isSupportedDocument(name)) return null;
  if (file.capabilities?.canDownload === false) return null;
  const relativePath = parentPath ? `${parentPath}/${name}` : name;
  const size = file.size ? Number(file.size) : null;
  const checksum = file.md5Checksum
    ? `md5:${file.md5Checksum}`
    : `drive:${file.version ?? "0"}:${file.modifiedTime ?? "unknown"}`;
  return {
    locator: `gdrive:${file.id}`,
    fileId: file.id,
    name,
    relativePath,
    originalMimeType: file.mimeType,
    mimeType: exported?.mimeType ?? file.mimeType,
    exportMimeType: exported?.mimeType ?? null,
    size: Number.isFinite(size) ? size : null,
    modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
    checksum,
    webViewLink: file.webViewLink ?? null,
  };
}

export async function googleDriveAccessToken(credentialsJson: string) {
  const credentials = googleDriveCredentials(credentialsJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: [DRIVE_READONLY_SCOPE],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Google Drive authentication returned no token.");
  return token;
}

export async function scanGoogleDriveFolder(input: {
  folderUrl: string;
  accessToken: string;
  includeSubdirectories: boolean;
  maxFiles: number;
  maxFileBytes: number;
  fetcher?: GoogleDriveFetch;
}) {
  const rootFolderId = googleDriveFolderId(input.folderUrl);
  if (!rootFolderId) throw new Error("The Google Drive folder URL is invalid.");
  const fetcher = input.fetcher ?? fetch;
  const rootUrl = new URL(`${DRIVE_API_BASE}/${rootFolderId}`);
  rootUrl.searchParams.set("fields", "id,name,mimeType,trashed");
  rootUrl.searchParams.set("supportsAllDrives", "true");
  const root = await driveJson<DriveApiFile & { trashed?: boolean }>(
    rootUrl,
    input.accessToken,
    fetcher,
  );
  if (root.trashed || root.mimeType !== GOOGLE_FOLDER_MIME_TYPE)
    throw new Error("The Google Drive URL does not point to an active folder.");

  const files: GoogleDriveSnapshotInput[] = [];
  const folders: Array<{ id: string; relativePath: string }> = [
    { id: rootFolderId, relativePath: "" },
  ];
  while (folders.length) {
    const folder = folders.shift()!;
    let pageToken: string | undefined;
    do {
      const listUrl = new URL(DRIVE_API_BASE);
      listUrl.searchParams.set(
        "q",
        `'${folder.id}' in parents and trashed = false`,
      );
      listUrl.searchParams.set(
        "fields",
        "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,version,webViewLink,capabilities(canDownload))",
      );
      listUrl.searchParams.set("pageSize", "1000");
      listUrl.searchParams.set("supportsAllDrives", "true");
      listUrl.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
      const page = await driveJson<DriveFileList>(
        listUrl,
        input.accessToken,
        fetcher,
      );
      for (const file of page.files ?? []) {
        if (!file.id || !file.name || !file.mimeType) continue;
        if (file.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
          if (input.includeSubdirectories)
            folders.push({
              id: file.id,
              relativePath: folder.relativePath
                ? `${folder.relativePath}/${safeDriveName(file.name)}`
                : safeDriveName(file.name),
            });
          continue;
        }
        const normalized = normalizedDriveFile(file, folder.relativePath);
        if (!normalized) continue;
        if (files.length >= input.maxFiles)
          throw new Error("The shared-folder file limit was exceeded.");
        if (
          normalized.size !== null &&
          (normalized.size < 1 || normalized.size > input.maxFileBytes)
        )
          continue;
        files.push(normalized);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return { rootFolderId, rootName: root.name ?? "Google Drive", files };
}

export async function downloadGoogleDriveFile(input: {
  file: GoogleDriveSnapshotInput;
  accessToken: string;
  maxFileBytes: number;
  fetcher?: GoogleDriveFetch;
}) {
  const url = input.file.exportMimeType
    ? new URL(`${DRIVE_API_BASE}/${input.file.fileId}/export`)
    : new URL(`${DRIVE_API_BASE}/${input.file.fileId}`);
  if (input.file.exportMimeType)
    url.searchParams.set("mimeType", input.file.exportMimeType);
  else url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await (input.fetcher ?? fetch)(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    throw new Error(apiErrorMessage(response.status, payload));
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > input.maxFileBytes)
    throw new Error(`${input.file.name} exceeds the upload size limit.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > input.maxFileBytes)
    throw new Error(`${input.file.name} is empty or exceeds the size limit.`);
  return {
    bytes,
    checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}
