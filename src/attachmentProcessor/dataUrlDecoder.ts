const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
  "application/octet-stream": "bin",
};

export const isDataUrl = (s: string): boolean => /^data:[^;,]+;base64,/.test(s);

export interface DecodedDataUrl {
  bytes: Buffer;
  mime: string;
  extension: string;
}

export const decodeDataUrl = (url: string): DecodedDataUrl => {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url);
  if (!m) throw new Error("Not a base64 data URL");
  const mime = m[1] as string;
  const payload = m[2] as string;
  const bytes = Buffer.from(payload, "base64");
  const extension = MIME_TO_EXT[mime] ?? mime.split("/")[1] ?? "bin";
  return { bytes, mime, extension };
};
