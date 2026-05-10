import { createServer, type Server } from "node:http";

export const startMockFilesApi = async (files: Record<string, { ct: string; body: Buffer }>) => {
  const server: Server = createServer((req, res) => {
    const m = /^\/api\/v1\/files\/([^/]+)\/content$/.exec(req.url ?? "");
    if (!m) { res.statusCode = 404; res.end(); return; }
    const fid = m[1] as string;
    const f = files[fid];
    if (!f) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", f.ct);
    res.end(f.body);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => server.close(() => r())) };
};
