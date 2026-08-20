const supportedExtensions = new Set([
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
]);

export function documentExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function isSupportedDocument(fileName: string) {
  return supportedExtensions.has(documentExtension(fileName));
}
