import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, Server } from "node:http";
import { fetchRemoteUrl } from "../../src/attachmentProcessor/remoteUrlFetcher.js";
import { UpstreamUrlFetchError } from "../../src/errors.js";

let server: Server; let port: number;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") {
      res.setHeader("content-type", "application/pdf");
      res.end("PDF-DATA");
    } else if (req.url === "/big") {
      res.setHeader("content-length", "100000000"); // 100 MB declared
      res.end();
    } else if (req.url === "/500") {
      res.statusCode = 500; res.end("nope");
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

describe("fetchRemoteUrl", () => {
  it("fetches a small response and returns bytes + content-type + filename", async () => {
    const r = await fetchRemoteUrl(`http://127.0.0.1:${port}/ok`, {
      maxBytes: 1024, timeoutMs: 5000, ssrfBypass: true,
    });
    expect(r.bytes.toString()).toBe("PDF-DATA");
    expect(r.contentType).toBe("application/pdf");
    expect(r.suggestedFilename).toBe("ok.pdf");
  });
  it("throws UpstreamUrlFetchError on 500", async () => {
    await expect(fetchRemoteUrl(`http://127.0.0.1:${port}/500`, {
      maxBytes: 1024, timeoutMs: 5000, ssrfBypass: true,
    })).rejects.toBeInstanceOf(UpstreamUrlFetchError);
  });
  it("aborts when content-length exceeds maxBytes", async () => {
    await expect(fetchRemoteUrl(`http://127.0.0.1:${port}/big`, {
      maxBytes: 1024, timeoutMs: 5000, ssrfBypass: true,
    })).rejects.toBeInstanceOf(UpstreamUrlFetchError);
  });
});
