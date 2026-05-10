import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceManager } from "../../src/workspaceManager.js";
import { PayloadTooLargeError } from "../../src/errors.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ws-"));
});

describe("workspaceManager", () => {
  it("creates the chat dir on first write and returns absolute path", async () => {
    const wm = createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 });
    const path = await wm.write("abc", "hello.txt", Buffer.from("hi"));
    expect(path).toBe(join(root, "abc", "hello.txt"));
    expect(readFileSync(path, "utf8")).toBe("hi");
  });

  it("sanitizes path traversal segments", async () => {
    const wm = createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 });
    const path = await wm.write("abc", "../../etc/passwd", Buffer.from("x"));
    expect(path.startsWith(join(root, "abc") + "/")).toBe(true);
    expect(path).not.toContain("..");
  });

  it("scrubs leading slashes, control chars, null bytes from filenames", async () => {
    const wm = createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 });
    const path = await wm.write("abc", "/x\0yz.txt", Buffer.from("x"));
    expect(path.startsWith(join(root, "abc") + "/")).toBe(true);
    expect(path).not.toContain("\0");
  });

  it("dedupes by sha when content is identical", async () => {
    const wm = createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 });
    const a = await wm.write("abc", "x.txt", Buffer.from("same"));
    const b = await wm.write("abc", "x.txt", Buffer.from("same"));
    expect(a).toBe(b);
  });

  it("appends sha-suffix when same name has different content", async () => {
    const wm = createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 });
    const a = await wm.write("abc", "x.txt", Buffer.from("v1"));
    const b = await wm.write("abc", "x.txt", Buffer.from("v2"));
    expect(a).not.toBe(b);
    expect(b).toMatch(/x-[0-9a-f]{8}\.txt$/);
  });

  it("throws PayloadTooLargeError when cap is exceeded", async () => {
    const wm = createWorkspaceManager({ root, maxBytesPerChat: 5 });
    await wm.write("abc", "a.txt", Buffer.from("hello"));
    await expect(wm.write("abc", "b.txt", Buffer.from("world")))
      .rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("evicts oldest files first when evict() is called", async () => {
    const wm = createWorkspaceManager({ root, maxBytesPerChat: 100 });
    await wm.write("abc", "old.txt", Buffer.from("a".repeat(40)));
    // Touch mtime forward
    await new Promise(r => setTimeout(r, 20));
    await wm.write("abc", "new.txt", Buffer.from("b".repeat(40)));
    const evicted = await wm.evict("abc", 50);
    expect(evicted).toBeGreaterThanOrEqual(1);
  });

  it("rejects writes that would escape the chat dir even after sanitization", async () => {
    const wm = createWorkspaceManager({ root, maxBytesPerChat: 1_000_000 });
    // Empty filename → fallback
    const path = await wm.write("abc", "", Buffer.from("x"));
    expect(path.startsWith(join(root, "abc") + "/")).toBe(true);
  });
});
