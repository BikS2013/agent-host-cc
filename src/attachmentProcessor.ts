import { decodeDataUrl, isDataUrl } from "./attachmentProcessor/dataUrlDecoder.js";
import { fetchRemoteUrl } from "./attachmentProcessor/remoteUrlFetcher.js";
import { fetchFromFilesApi, type FilesApiOptions } from "./attachmentProcessor/filesApiFetcher.js";
import { extractUrls } from "./attachmentProcessor/urlDetector.js";
import type { WorkspaceManager } from "./workspaceManager.js";
import type { ContentPart, FileRef, Message, AttachmentManifest } from "./types.js";

export interface AttachmentProcessorOptions {
  workspace: WorkspaceManager;
  // `filesApi` may be undefined when FILES_API_BASE_URL / FILES_API_KEY are
  // unset — in that case any incoming `files[]` entry will be surfaced as a
  // failed-upstream-fetch in the manifest (the agent turn still proceeds, but
  // the file body is not delivered). This is the same swallow-and-continue
  // semantics applied to every other failed fetch in this processor.
  filesApi: FilesApiOptions | undefined;
  remote: { maxBytes: number; timeoutMs: number; maxFetchesPerTurn: number };
  maxInlineImageBytes: number;
}

export interface ProcessInput {
  chatId: string;
  messages: Message[];
  files: FileRef[];
}

export interface ProcessOutput {
  cleanedMessages: Message[];
  manifest: AttachmentManifest;
}

export const createAttachmentProcessor = (opts: AttachmentProcessorOptions) => ({
  async process(input: ProcessInput): Promise<ProcessOutput> {
    const manifest: AttachmentManifest = [];
    const cleanedMessages: Message[] = [];
    let urlBudget = opts.remote.maxFetchesPerTurn;

    for (const m of input.messages) {
      const parts: ContentPart[] = Array.isArray(m.content)
        ? m.content
        : [{ type: "text", text: m.content }];
      const textOut: string[] = [];
      const imageParts: ContentPart[] = [];

      for (const p of parts) {
        if (p.type === "text") {
          textOut.push(p.text);
          if (urlBudget > 0) {
            const urls = extractUrls(p.text).slice(0, urlBudget);
            for (const u of urls) {
              try {
                const r = await fetchRemoteUrl(u, opts.remote);
                const path = await opts.workspace.write(input.chatId, r.suggestedFilename, r.bytes);
                manifest.push({ path, kind: "url", originalRef: u, inlineImage: false });
                urlBudget -= 1;
              } catch {
                // swallow per spec — manifest line omitted; agent still runs
              }
            }
          }
        } else if (p.type === "image_url") {
          const url = p.image_url.url;
          if (isDataUrl(url)) {
            const dec = decodeDataUrl(url);
            const fname = `img-${Date.now()}.${dec.extension}`;
            const path = await opts.workspace.write(input.chatId, fname, dec.bytes);
            const inlineImage = dec.bytes.length <= opts.maxInlineImageBytes && dec.mime.startsWith("image/");
            manifest.push({ path, kind: "image", originalRef: "data-url", inlineImage });
            if (inlineImage) imageParts.push(p);
            else textOut.push(`(image too large for inline; saved to ${path})`);
          } else {
            try {
              const r = await fetchRemoteUrl(url, opts.remote);
              const path = await opts.workspace.write(input.chatId, r.suggestedFilename, r.bytes);
              manifest.push({ path, kind: "image", originalRef: url, inlineImage: false });
              textOut.push(`(image fetched from ${url}; saved to ${path})`);
            } catch {
              // skip
            }
          }
        }
      }

      let combined = textOut.join("\n").trim();
      if (combined === "" && imageParts.length === 0) combined = " ";
      const newContent: ContentPart[] = [{ type: "text", text: combined }, ...imageParts];
      cleanedMessages.push({ ...m, content: newContent });
    }

    // files[] processed once — attached to the last user message manifest.
    // If `filesApi` is undefined (FILES_API_BASE_URL/KEY not configured) the
    // entries are silently dropped, matching the swallow-on-fetch-failure
    // contract documented for this processor.
    if (opts.filesApi !== undefined) {
      const filesApi = opts.filesApi;
      for (const f of input.files) {
        try {
          const r = await fetchFromFilesApi(f.id, filesApi);
          const path = await opts.workspace.write(input.chatId, f.name ?? f.id, r.bytes);
          manifest.push({ path, kind: "file", originalRef: f.id, inlineImage: false });
        } catch {
          // swallow per spec
        }
      }
    }

    if (manifest.length > 0) {
      const lastUserIdx = cleanedMessages.map(m => m.role).lastIndexOf("user");
      if (lastUserIdx >= 0) {
        const msg = cleanedMessages[lastUserIdx];
        if (msg && Array.isArray(msg.content)) {
          const lines = manifest.map(e => `  - ${e.path}  (${e.kind}${e.inlineImage ? "; also shown above" : ""})`);
          const note = `\n\n[Attached files in ${input.chatId}'s workspace:\n${lines.join("\n")}]`;
          const textPart = msg.content.find(p => p.type === "text");
          if (textPart && textPart.type === "text") {
            textPart.text += note;
          }
        }
      }
    }

    return { cleanedMessages, manifest };
  },
});
