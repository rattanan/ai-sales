function encodeRfc5987Value(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function quotedAsciiFileName(value: string) {
  return value.replace(/[^\x20-\x7e]|["\\]/g, "-");
}

export function attachmentContentDisposition(
  fileName: string,
  fallbackFileName = "download",
) {
  const normalizedFileName = fileName.normalize("NFC").replace(/[\r\n]/g, "-");
  const legacyFileName = /^[\x20-\x7e]+$/.test(normalizedFileName)
    ? normalizedFileName
    : fallbackFileName;

  return `attachment; filename="${quotedAsciiFileName(legacyFileName)}"; filename*=UTF-8''${encodeRfc5987Value(normalizedFileName)}`;
}
