import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttachmentProcessor } from "../../src/attachmentProcessor.js";
import { createWorkspaceManager } from "../../src/workspaceManager.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ap-")); });

describe("attachmentProcessor", () => {
  it("processes a data: image_url -> keeps it inline + writes to disk", async () => {
    const ap = createAttachmentProcessor({
      workspace: createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 }),
      filesApi: { baseUrl: "http://x", apiKey: "k", maxBytes: 1024, timeoutMs: 5000 },
      remote: { maxBytes: 1024, timeoutMs: 5000, maxFetchesPerTurn: 5 },
      maxInlineImageBytes: 100,
    });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const result = await ap.process({
      chatId: "abc",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
        ],
      }],
      files: [],
    });
    expect(result.manifest.length).toBe(1);
    expect(result.manifest[0]!.kind).toBe("image");
    expect(result.manifest[0]!.inlineImage).toBe(true);
    expect(result.cleanedMessages[0]!.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url" }),
    ]));
  });

  it("oversize image -> disk only, not inline", async () => {
    const ap = createAttachmentProcessor({
      workspace: createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 }),
      filesApi: { baseUrl: "http://x", apiKey: "k", maxBytes: 1024, timeoutMs: 5000 },
      remote: { maxBytes: 1024, timeoutMs: 5000, maxFetchesPerTurn: 5 },
      maxInlineImageBytes: 2,
    });
    const png = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString("base64");
    const r = await ap.process({
      chatId: "abc",
      messages: [{
        role: "user",
        content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }],
      }],
      files: [],
    });
    expect(r.manifest[0]!.inlineImage).toBe(false);
  });

  it("empty content after stripping -> injects a single space so SDK accepts it", async () => {
    const ap = createAttachmentProcessor({
      workspace: createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 }),
      filesApi: { baseUrl: "http://x", apiKey: "k", maxBytes: 1024, timeoutMs: 5000 },
      remote: { maxBytes: 1024, timeoutMs: 5000, maxFetchesPerTurn: 5 },
      maxInlineImageBytes: 1024,
    });
    const r = await ap.process({
      chatId: "abc",
      messages: [{ role: "user", content: [] as never }],
      files: [],
    });
    expect(r.cleanedMessages[0]!.content).toBeTruthy();
  });
});
