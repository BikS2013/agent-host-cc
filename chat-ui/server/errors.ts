// Typed error hierarchy for the chat-ui server.
//
// Mirrors the host service's `src/errors.ts` shape so error envelopes look
// uniform across the project: `{ error: { type, message, ...extras } }`.
//
// Per project rule "no fallback for required configuration", every required
// configuration value missing at startup MUST throw `ConfigurationError`.

export type ChatUiErrorType =
  | "configuration"
  | "profile_not_found"
  | "invalid_profile"
  | "upstream_error"
  | "internal";

export abstract class ChatUiError extends Error {
  abstract readonly httpStatus: number;
  abstract readonly errorType: ChatUiErrorType;

  toEnvelope(): { error: Record<string, unknown> } {
    const base: Record<string, unknown> = {
      type: this.errorType,
      message: this.message,
    };
    for (const [k, v] of Object.entries(this.extras())) {
      base[k] = v;
    }
    return { error: base };
  }

  protected extras(): Record<string, unknown> {
    return {};
  }
}

export class ConfigurationError extends ChatUiError {
  readonly httpStatus = 500;
  readonly errorType = "configuration" as const;

  constructor(public readonly varName: string, message?: string) {
    super(message ?? `Required configuration variable missing or invalid: ${varName}`);
  }

  protected override extras(): Record<string, unknown> {
    return { varName: this.varName };
  }
}

export class ProfileNotFoundError extends ChatUiError {
  readonly httpStatus = 404;
  readonly errorType = "profile_not_found" as const;

  constructor(public readonly profileId: string, message?: string) {
    super(message ?? `Profile not found: ${profileId}`);
  }

  protected override extras(): Record<string, unknown> {
    return { profileId: this.profileId };
  }
}

export interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

export class ValidationError extends ChatUiError {
  readonly httpStatus = 422;
  readonly errorType = "invalid_profile" as const;

  constructor(message: string, public readonly issues: ZodIssueLike[] = []) {
    super(message);
  }

  protected override extras(): Record<string, unknown> {
    return { issues: this.issues };
  }
}

export class UpstreamError extends ChatUiError {
  readonly httpStatus = 502;
  readonly errorType = "upstream_error" as const;

  constructor(
    public readonly status: number,
    message: string,
    public readonly upstreamBody?: string,
  ) {
    super(message);
  }

  protected override extras(): Record<string, unknown> {
    const out: Record<string, unknown> = { status: this.status };
    if (typeof this.upstreamBody === "string" && this.upstreamBody.length > 0) {
      out["upstreamBody"] = this.upstreamBody;
    }
    return out;
  }
}
