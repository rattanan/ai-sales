export function googleDriveFolderId(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com")
    return null;
  const match = url.pathname.match(
    /^\/drive(?:\/u\/\d+)?\/folders\/([A-Za-z0-9_-]+)(?:\/|$)/,
  );
  return match?.[1] ?? null;
}

export function isGoogleDriveFolderUrl(rawValue: string) {
  return googleDriveFolderId(rawValue) !== null;
}

export function canonicalGoogleDriveFolderUrl(rawUrl: string) {
  const folderId = googleDriveFolderId(rawUrl);
  if (!folderId)
    throw new Error(
      "Enter a Google Drive folder URL such as https://drive.google.com/drive/folders/…",
    );
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function googleDriveCredentials(credentialsJson: string) {
  try {
    const serialized = credentialsJson.trim().startsWith("{")
      ? credentialsJson
      : Buffer.from(credentialsJson, "base64").toString("utf8");
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    throw new Error(
      "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not valid JSON or base64 JSON.",
    );
  }
}

export function googleDriveServiceAccountEmail(credentialsJson: string) {
  const email = googleDriveCredentials(credentialsJson).client_email;
  return typeof email === "string" && email.includes("@") ? email : null;
}

export function configuredGoogleDriveServiceAccountEmail(
  credentialsJson: string | undefined,
) {
  if (!credentialsJson) return null;
  try {
    return googleDriveServiceAccountEmail(credentialsJson);
  } catch {
    return null;
  }
}
