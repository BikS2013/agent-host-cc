import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, Server } from "node:http";
import { fetchFromFilesApi } from "../../src/attachmentProcessor/filesApiFetcher.js";
import { UpstreamFilesFetchError } from "../../src/errors.js";

let server: Server; let port: number;
beforeAll(async () => {
  server = createServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth !== "Bearer ow-key") { res.statusCode = 401; res.end(); return; }
    if (req.url === "/api/v1/files/f-1/content") {
      res.setHeader("content-type", "application/zip");
      res.end("ZIP");
    } else if (req.url === "/files/alt-1") {
      res.setHeader("content-type", "text/plain");
      res.end("ALT");
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => server.close());

describe("fetchFromFilesApi", () => {
  it("fetches the file with bearer auth using the default path template", async () => {
    const r = await fetchFromFilesApi("f-1", {
      baseUrl: `http://127.0.0.1:${port}`, apiKey: "ow-key",
      pathTemplate: "/api/v1/files/{id}/content",
      maxBytes: 1024, timeoutMs: 5000,
    });
    expect(r.bytes.toString()).toBe("ZIP");
    expect(r.contentType).toBe("application/zip");
  });
  it("supports an alternate path template via {id} substitution", async () => {
    const r = await fetchFromFilesApi("alt-1", {
      baseUrl: `http://127.0.0.1:${port}`, apiKey: "ow-key",
      pathTemplate: "/files/{id}",
      maxBytes: 1024, timeoutMs: 5000,
    });
    expect(r.bytes.toString()).toBe("ALT");
    expect(r.contentType).toBe("text/plain");
  });
  it("throws UpstreamFilesFetchError on 404", async () => {
    await expect(fetchFromFilesApi("missing", {
      baseUrl: `http://127.0.0.1:${port}`, apiKey: "ow-key",
      pathTemplate: "/api/v1/files/{id}/content",
      maxBytes: 1024, timeoutMs: 5000,
    })).rejects.toBeInstanceOf(UpstreamFilesFetchError);
  });
});
