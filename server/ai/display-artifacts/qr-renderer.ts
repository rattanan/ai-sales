import QRCode from "qrcode";

const MAX_PAYLOAD_LENGTH = 1_024;
const QUIET_ZONE = 4;

export class QrPayloadError extends Error {}

/**
 * Bill-payment payloads are emitted by upstream systems with whitespace
 * separators, while scanners expect line separators. Everything else is kept
 * byte-for-byte apart from surrounding whitespace.
 */
export function normalizeQrPayload(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) throw new QrPayloadError("QR payload is empty.");
  if (trimmed.length > MAX_PAYLOAD_LENGTH)
    throw new QrPayloadError("QR payload is too long.");
  if (!trimmed.startsWith("|")) return trimmed;

  const fields = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (fields.length < 2 || fields.length > 4)
    throw new QrPayloadError(
      "Bill-payment QR payload must contain 2-4 numeric fields.",
    );
  if (fields.some((field) => !/^\d+$/.test(field)))
    throw new QrPayloadError(
      "Bill-payment QR fields must contain digits only.",
    );
  return `|${fields.join("\n")}`;
}

/** Server-authored standalone SVG; no model-controlled markup crosses out. */
export function renderQrSvg(payload: string) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const total = size + QUIET_ZONE * 2;
  const segments: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.data[y * size + x])
        segments.push(`M${x + QUIET_ZONE},${y + QUIET_ZONE}h1v1h-1z`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="100%" height="100%" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${segments.join("")}" fill="#000000"/>` +
    `</svg>`
  );
}
