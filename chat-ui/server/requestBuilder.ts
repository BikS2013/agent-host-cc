// Pure builder that turns a Profile + an OpenAI Chat Completions body into
// the upstream HTTP call shape `{ url, headers, body }`.
//
// Per docs/design/project-design.md §14.8:
//   - agent-host-cc → POST {baseUrl}/v1/chat/completions, Authorization: Bearer
//                      The `model` field is forwarded VERBATIM (with cc. prefix
//                      if present); the host service strips its MODEL_PREFIX
//                      server-side.
//   - openai        → POST {baseUrl}/v1/chat/completions, Authorization: Bearer
//                      baseUrl falls back to https://api.openai.com (the only
//                      authorised default in this builder, mirroring the
//                      schema-level default).
//   - azure-openai  → POST {endpoint}/openai/deployments/{deployment}/chat/
//                      completions?api-version={apiVersion}, header api-key:
//                      The `model` field MUST be stripped from the body
//                      (Azure infers it from the deployment name).
//
// The function is sync, side-effect-free, and fully unit-testable.

import type { Profile } from "./profileSchema.js";

/** OpenAI-format chat message, the only role/content shape we forward. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Request body the SPA sends to /api/chat (after Zod validation). */
export interface UpstreamRequestInput {
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

/** What the relay needs to issue an undici.request. */
export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const trimTrailingSlash = (s: string): string => (s.endsWith("/") ? s.slice(0, -1) : s);

/**
 * Apply profile-level pre-processing common to all three branches:
 *  1. Prepend `profile.systemPrompt` if set AND the first message is not
 *     already a system message.
 *  2. Fill `temperature` / `max_tokens` from the profile if absent in the
 *     incoming body.
 *
 * Returns a NEW object; does not mutate the input.
 */
const applyProfileDefaults = (
  profile: Profile,
  body: UpstreamRequestInput,
): UpstreamRequestInput => {
  let messages = body.messages.slice();
  const sp = profile.systemPrompt;
  if (typeof sp === "string" && sp.length > 0) {
    const firstRole = messages[0]?.role;
    if (firstRole !== "system") {
      messages = [{ role: "system", content: sp }, ...messages];
    }
  }
  const out: UpstreamRequestInput = {
    messages,
    stream: body.stream ?? true,
  };
  if (body.temperature !== undefined) {
    out.temperature = body.temperature;
  } else if (profile.temperature !== undefined) {
    out.temperature = profile.temperature;
  }
  if (body.max_tokens !== undefined) {
    out.max_tokens = body.max_tokens;
  } else if (profile.maxTokens !== undefined) {
    out.max_tokens = profile.maxTokens;
  }
  return out;
};

/**
 * Build the upstream HTTP call shape for the given profile and OpenAI-format
 * body. Pure; no I/O.
 */
export function buildUpstreamRequest(
  profile: Profile,
  rawBody: UpstreamRequestInput,
): UpstreamRequest {
  const merged = applyProfileDefaults(profile, rawBody);

  switch (profile.backendKind) {
    case "agent-host-cc": {
      const url = `${trimTrailingSlash(profile.baseUrl)}/v1/chat/completions`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${profile.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      const bodyJson: Record<string, unknown> = {
        model: profile.defaultModel, // verbatim — includes the host's MODEL_PREFIX
        messages: merged.messages,
        stream: merged.stream ?? true,
      };
      if (merged.temperature !== undefined) bodyJson["temperature"] = merged.temperature;
      if (merged.max_tokens !== undefined) bodyJson["max_tokens"] = merged.max_tokens;
      return { url, headers, body: JSON.stringify(bodyJson) };
    }

    case "openai": {
      // The schema's `.default("https://api.openai.com")` guarantees baseUrl
      // is non-undefined, but we keep the `??` as belt-and-braces for type
      // narrowing and resilience against direct (non-Zod) profile sources.
      const baseUrl = profile.baseUrl ?? "https://api.openai.com";
      const url = `${trimTrailingSlash(baseUrl)}/v1/chat/completions`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${profile.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      const bodyJson: Record<string, unknown> = {
        model: profile.defaultModel,
        messages: merged.messages,
        stream: merged.stream ?? true,
      };
      if (merged.temperature !== undefined) bodyJson["temperature"] = merged.temperature;
      if (merged.max_tokens !== undefined) bodyJson["max_tokens"] = merged.max_tokens;
      return { url, headers, body: JSON.stringify(bodyJson) };
    }

    case "azure-openai": {
      const endpoint = trimTrailingSlash(profile.endpoint);
      const url =
        `${endpoint}/openai/deployments/${encodeURIComponent(profile.deployment)}` +
        `/chat/completions?api-version=${encodeURIComponent(profile.apiVersion)}`;
      const headers: Record<string, string> = {
        "api-key": profile.apiKey,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      // Azure infers model from the deployment in the URL — `model` MUST be
      // omitted from the body.
      const bodyJson: Record<string, unknown> = {
        messages: merged.messages,
        stream: merged.stream ?? true,
      };
      if (merged.temperature !== undefined) bodyJson["temperature"] = merged.temperature;
      if (merged.max_tokens !== undefined) bodyJson["max_tokens"] = merged.max_tokens;
      return { url, headers, body: JSON.stringify(bodyJson) };
    }

    default: {
      // Exhaustiveness check
      const _never: never = profile;
      void _never;
      throw new Error(`unknown backendKind on profile: ${JSON.stringify(profile)}`);
    }
  }
}
