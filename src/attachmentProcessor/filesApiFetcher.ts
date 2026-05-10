import { request } from "undici";
import { UpstreamFilesFetchError } from "../errors.js";

export interface FilesApiOptions {
  baseUrl: string;
  apiKey: string;
  pathTemplate: string;
  maxBytes: number;
  timeoutMs: number;
}
export interface FetchedFile {
  bytes: Buffer; contentType: string;
}

export const fetchFromFilesApi = async (id: string, opts: FilesApiOptions): Promise<FetchedFile> => {
  const path = opts.pathTemplate.replace("{id}", encodeURIComponent(id));
  const url = `${opts.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await request(url, {
      headers: { authorization: `Bearer ${opts.apiKey}` },
      signal: ctrl.signal,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      await res.body.dump().catch(() => undefined);
      throw new UpstreamFilesFetchError(id, res.statusCode);
    }
    const chunks: Buffer[] = []; let total = 0;
    for await (const c of res.body) {
      const b = c as Buffer; total += b.length;
      if (total > opts.maxBytes) {
        await res.body.dump().catch(() => undefined);
        throw new UpstreamFilesFetchError(id, 413);
      }
      chunks.push(b);
    }
    const ctRaw = String(res.headers["content-type"] ?? "application/octet-stream");
    const ct = ctRaw.split(";")[0]?.trim() ?? "application/octet-stream";
    return { bytes: Buffer.concat(chunks), contentType: ct };
  } finally { clearTimeout(t); }
};
