import { z } from "zod";

export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ImageUrlPartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});

export const ContentPartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  ImageUrlPartSchema,
]);

export const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(ContentPartSchema).min(1)]),
  name: z.string().optional(),
});

export const FileRefSchema = z.object({
  type: z.literal("file"),
  id: z.string().min(1),
  name: z.string().optional(),
});

export const ChatCompletionRequestSchema = z.looseObject({
  model: z.string().min(1),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().int().optional(),
  metadata: z.looseObject({ chat_id: z.string().optional() }).optional(),
  files: z.array(FileRefSchema).optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ContentPart = z.infer<typeof ContentPartSchema>;
export type FileRef = z.infer<typeof FileRefSchema>;

export interface AttachmentManifestEntry {
  path: string;
  kind: "image" | "file" | "url";
  originalRef: string;
  inlineImage: boolean;
}
export type AttachmentManifest = AttachmentManifestEntry[];

export type Provider =
  | { kind: "anthropic-public"; apiKey: string; apiKeyExpiresAt?: string }
  | { kind: "anthropic-foundry"; apiKey: string; resource: string; apiKeyExpiresAt?: string };

// ---------------------------------------------------------------------------
// Responses API (plan-003) — request schemas
// ---------------------------------------------------------------------------

export const ResponsesInputTextPartSchema = z.object({
  type: z.literal("input_text"),
  text: z.string(),
});

export const ResponsesInputImagePartSchema = z.object({
  type: z.literal("input_image"),
  image_url: z.string(), // accepts either a `data:` URL or http(s); attachmentProcessor handles both
  detail: z.enum(["auto", "low", "high"]).optional(),
});

export const ResponsesInputContentPartSchema = z.discriminatedUnion("type", [
  ResponsesInputTextPartSchema,
  ResponsesInputImagePartSchema,
]);

export const ResponsesInputMessageSchema = z.object({
  role: z.enum(["user", "system", "assistant"]),
  content: z.union([z.string(), z.array(ResponsesInputContentPartSchema)]),
});

export const ResponsesFileRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
});

export const ResponsesRequestSchema = z.looseObject({
  model: z.string().min(1),
  input: z.union([z.string(), z.array(ResponsesInputMessageSchema)]),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_output_tokens: z.number().int().optional(),
  metadata: z.looseObject({ chat_id: z.string().optional() }).optional(),
  files: z.array(ResponsesFileRefSchema).optional(),
});

export type ResponsesRequest = z.infer<typeof ResponsesRequestSchema>;
export type ResponsesInputMessage = z.infer<typeof ResponsesInputMessageSchema>;
export type ResponsesInputContentPart = z.infer<typeof ResponsesInputContentPartSchema>;
export type ResponsesFileRef = z.infer<typeof ResponsesFileRefSchema>;
