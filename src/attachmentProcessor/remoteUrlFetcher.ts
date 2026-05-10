import { request } from "undici";
import { UpstreamUrlFetchError } from "../errors.js";
import { assertSafeUrl } from "./ssrfGuard.js";

const CT_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "image/png": "png",
  "image/jpeg": "jpg",
  "text/plain": "txt",
  "text/html": "html",
  "application/json": "json",
};

export interface FetchOptions {
  maxBytes: number;
  timeoutMs: number;
  ssrfBypass?: boolean; // for tests only
}

export interface FetchedRemote {
  bytes: Buffer;
  contentType: string;
  suggestedFilename: string;
}

export const fetchRemoteUrl = async (url: string, opts: FetchOptions): Promise<FetchedRemote> => {
  if (!opts.ssrfBypass) await assertSafeUrl(url);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await request(url, { signal: ctrl.signal });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      await res.body.dump().catch(() => undefined);
      throw new UpstreamUrlFetchError(url, res.statusCode);
    }
    const declared = Number.parseInt(String(res.headers["content-length"] ?? ""), 10);
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      await res.body.dump().catch(() => undefined);
      throw new UpstreamUrlFetchError(url, 413);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body) {
      const buf = chunk as Buffer;
      total += buf.length;
      if (total > opts.maxBytes) {
        await res.body.dump().catch(() => undefined);
        throw new UpstreamUrlFetchError(url, 413);
      }
      chunks.push(buf);
    }
    const ctRaw = String(res.headers["content-type"] ?? "application/octet-stream");
    const ctParts = ctRaw.split(";");
    const ct = (ctParts[0]?.trim() ?? "") || "application/octet-stream";
    const ctSlashParts = ct.split("/");
    const ctSubtype = ctSlashParts[1] ?? "bin";
    const ext = CT_TO_EXT[ct] ?? ctSubtype;
    const urlPathPart = url.split("?")[0] ?? url;
    const last = urlPathPart.split("/").filter(Boolean).pop() ?? "remote";
    const baseName = /\.[a-z0-9]+$/i.test(last) ? last : `${last}.${ext}`;
    return { bytes: Buffer.concat(chunks), contentType: ct, suggestedFilename: baseName };
  } finally {
    clearTimeout(t);
  }
};
