// Profile schema (Zod 4 discriminated union on `backendKind`).
//
// Single source of truth for the on-disk profiles.json shape and the
// REST API request/response bodies. See docs/design/project-design.md §14.4.
//
// No-fallback rule: the ONLY schema-level default permitted in v1 is
// `openai.baseUrl = "https://api.openai.com"` (refined-request FU-6). All
// other required fields throw a ZodError on absence — translated to
// `ValidationError` (HTTP 422) in profileRoutes.

import { z } from "zod";

/** Sentinel emitted on the wire in place of the real apiKey on every read. */
export const REDACTED_API_KEY = "<redacted>";

/** Fields shared by every profile variant. `id` is server-assigned. */
const ProfileBaseFieldsSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "name must be non-empty"),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

/** Variant: the local agent-host-cc service or another instance of it. */
const AgentHostProfileSchema = ProfileBaseFieldsSchema.extend({
  backendKind: z.literal("agent-host-cc"),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  // Note: the host service strips MODEL_PREFIX (default "cc.") server-side.
  // Profiles that target the local backend must INCLUDE the prefix here, e.g.
  // "cc.claude-sonnet-4-6". This is enforced as documentation, not as schema,
  // because the prefix is operator-configurable on the host service.
  defaultModel: z.string().min(1),
});

/** Variant: the official OpenAI public API. */
const OpenAiProfileSchema = ProfileBaseFieldsSchema.extend({
  backendKind: z.literal("openai"),
  // Authorised default per FU-6.
  baseUrl: z.string().url().default("https://api.openai.com"),
  apiKey: z.string().min(1),
  defaultModel: z.string().min(1),
});

/** Variant: Azure AI Foundry / Azure OpenAI deployments (key-based auth). */
const AzureOpenAiProfileSchema = ProfileBaseFieldsSchema.extend({
  backendKind: z.literal("azure-openai"),
  endpoint: z.string().url(),
  deployment: z.string().min(1),
  apiVersion: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(-preview)?$/, "apiVersion must look like 2024-10-21 or 2024-10-21-preview"),
  apiKey: z.string().min(1),
  // No defaultModel: model is implied by the deployment name in the URL.
});

/**
 * The full profile schema — discriminated union over `backendKind`.
 * Use `ProfileSchema.safeParse(...)` for input validation.
 */
export const ProfileSchema = z.discriminatedUnion("backendKind", [
  AgentHostProfileSchema,
  OpenAiProfileSchema,
  AzureOpenAiProfileSchema,
]);

export type Profile = z.infer<typeof ProfileSchema>;

export type AgentHostProfile = z.infer<typeof AgentHostProfileSchema>;
export type OpenAiProfile = z.infer<typeof OpenAiProfileSchema>;
export type AzureOpenAiProfile = z.infer<typeof AzureOpenAiProfileSchema>;

/**
 * Schema for inputs to POST /api/profiles (create) — same as Profile but
 * without an `id` (the server assigns it).
 */
export const CreateProfileInputSchema = z.discriminatedUnion("backendKind", [
  AgentHostProfileSchema.omit({ id: true }),
  OpenAiProfileSchema.omit({ id: true }),
  AzureOpenAiProfileSchema.omit({ id: true }),
]);
export type CreateProfileInput = z.infer<typeof CreateProfileInputSchema>;

/**
 * Schema for inputs to PUT /api/profiles/:id (update) — same as Profile.
 * The route handler additionally enforces that body.id === url.id, and
 * applies the "<redacted>"/"" preserves-existing-key semantics.
 */
export const UpdateProfileInputSchema = ProfileSchema;
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

/**
 * The full profiles.json file shape. Refines uniqueness of `name` across
 * all profiles in the file.
 */
export const ProfileStoreShapeSchema = z
  .object({
    activeProfileId: z.string().uuid().nullable(),
    profiles: z.array(ProfileSchema),
  })
  .refine(
    (file) => new Set(file.profiles.map((p) => p.name)).size === file.profiles.length,
    { message: "Profile names must be unique", path: ["profiles"] },
  );

export type ProfileStoreShape = z.infer<typeof ProfileStoreShapeSchema>;

/**
 * Replace the apiKey on a profile with the literal "<redacted>" sentinel
 * before sending it back to the SPA. Pure; does not mutate the input.
 *
 * The PUT endpoint relies on this exact sentinel value to detect
 * "no key rotation requested" — see profileRoutes / §14.6.3.
 */
export function redactProfile<P extends Profile>(p: P): P {
  return { ...p, apiKey: REDACTED_API_KEY } as P;
}
