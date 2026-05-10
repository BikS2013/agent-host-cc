import { createServer, type Server } from "node:http";

export interface MockAnthropicProvider { url: string; close: () => Promise<void>; lastBody: () => unknown; }

export const startMockAnthropicProvider = async (responseChunks: string[]): Promise<MockAnthropicProvider> => {
  let lastBody: unknown;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try { lastBody = JSON.parse(body); } catch { lastBody = body; }
      res.setHeader("content-type", "text/event-stream");
      for (const c of responseChunks) res.write(`data: ${c}\n\n`);
      res.end();
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    lastBody: () => lastBody,
    close: () => new Promise<void>(r => server.close(() => r())),
  };
};
