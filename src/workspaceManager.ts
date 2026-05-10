import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve, sep } from "node:path";
import { PayloadTooLargeError } from "./errors.js";

export interface WorkspaceManagerOptions {
  root: string;
  maxBytesPerChat: number;
}

const sanitizeFilename = (name: string): string => {
  // Strip null bytes, control chars, and path separators
  let s = name.replace(/\0/g, "").replace(/[\x00-\x1f]/g, "_");
  s = s.replace(/^\/+/, "");                  // leading slashes
  s = s.split(/[\\/]/).filter(Boolean).pop() ?? ""; // last path segment
  s = s.replace(/\.{2,}/g, "_");              // multiple dots
  if (s === "" || s === "." || s === "..") s = "file";
  if (s.length > 200) s = s.slice(0, 200);
  return s;
};

const sha256Hex = (data: Buffer): string =>
  createHash("sha256").update(data).digest("hex");

const splitName = (name: string): { stem: string; ext: string } => {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, idx), ext: name.slice(idx) };
};

const dirSize = async (dir: string): Promise<number> => {
  let total = 0;
  let entries: string[];
  try { entries = await fs.readdir(dir); } catch { return 0; }
  for (const e of entries) {
    const st = await fs.stat(join(dir, e));
    if (st.isFile()) total += st.size;
  }
  return total;
};

export interface WorkspaceManager {
  write(chatId: string, filename: string, data: Buffer): Promise<string>;
  evict(chatId: string, bytesToFree: number): Promise<number>;
  size(chatId: string): Promise<number>;
}

export const createWorkspaceManager = (opts: WorkspaceManagerOptions): WorkspaceManager => {
  const safeChatDir = (chatId: string): string => {
    const safe = sanitizeFilename(chatId).replace(/\.+/g, "_") || "default";
    const target = resolve(opts.root, safe);
    if (!target.startsWith(resolve(opts.root) + sep)) {
      throw new Error("chat dir escaped workspace root");
    }
    return target;
  };

  return {
    async write(chatId, filename, data) {
      const dir = safeChatDir(chatId);
      await fs.mkdir(dir, { recursive: true });
      const cleaned = sanitizeFilename(filename);
      const sha = sha256Hex(data);
      const target = join(dir, cleaned);
      try {
        const existing = await fs.readFile(target);
        if (sha256Hex(existing) === sha) return target; // dedupe
        const { stem, ext } = splitName(cleaned);
        const suffixed = join(dir, `${stem}-${sha.slice(0, 8)}${ext}`);
        const current = await dirSize(dir);
        if (current + data.length > opts.maxBytesPerChat) {
          throw new PayloadTooLargeError(opts.maxBytesPerChat, current + data.length);
        }
        await fs.writeFile(suffixed, data);
        return suffixed;
      } catch (err) {
        if (err instanceof PayloadTooLargeError) throw err;
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        const current = await dirSize(dir);
        if (current + data.length > opts.maxBytesPerChat) {
          throw new PayloadTooLargeError(opts.maxBytesPerChat, current + data.length);
        }
        await fs.writeFile(target, data);
        return target;
      }
    },

    async evict(chatId, bytesToFree) {
      const dir = safeChatDir(chatId);
      let freed = 0;
      let evictedCount = 0;
      let entries: string[];
      try { entries = await fs.readdir(dir); } catch { return 0; }
      const stats = await Promise.all(entries.map(async e => {
        const p = join(dir, e);
        const st = await fs.stat(p);
        return { p, mtimeMs: st.mtimeMs, size: st.size };
      }));
      stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const s of stats) {
        if (freed >= bytesToFree) break;
        await fs.unlink(s.p);
        freed += s.size;
        evictedCount += 1;
      }
      return evictedCount;
    },

    async size(chatId) {
      return dirSize(safeChatDir(chatId));
    },
  };
};
