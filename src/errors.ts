export type ErrorType =
  | "configuration"
  | "unauthorized"
  | "invalid_request"
  | "model_not_found"
  | "payload_too_large"
  | "upstream_files_fetch_failed"
  | "upstream_url_fetch_failed"
  | "unsafe_url"
  | "agent_error"
  | "agent_timeout"
  | "internal";

export abstract class AgentHostError extends Error {
  abstract readonly httpStatus: number;
  abstract readonly errorType: ErrorType;
  toErrorEnvelope(): unknown {
    const base: Record<string, unknown> = { type: this.errorType, message: this.message };
    for (const [k, v] of Object.entries(this.extras())) base[k] = v;
    return { error: base };
  }
  protected extras(): Record<string, unknown> { return {}; }
}

export class ConfigurationError extends AgentHostError {
  readonly httpStatus = 500;
  readonly errorType = "configuration" as const;
  constructor(public readonly varName: string, message?: string) {
    super(message ?? `Required configuration variable missing or invalid: ${varName}`);
  }
  protected override extras() { return { varName: this.varName }; }
}

export class UnauthorizedError extends AgentHostError {
  readonly httpStatus = 401;
  readonly errorType = "unauthorized" as const;
  constructor(message = "Unauthorized") { super(message); }
}

export interface ZodIssueLike { path: (string | number)[]; message: string; }

export class InvalidRequestError extends AgentHostError {
  readonly httpStatus = 422;
  readonly errorType = "invalid_request" as const;
  constructor(message: string, public readonly issues: ZodIssueLike[]) { super(message); }
  protected override extras() { return { issues: this.issues }; }
}

export class ModelNotFoundError extends AgentHostError {
  readonly httpStatus = 404;
  readonly errorType = "model_not_found" as const;
  constructor(public readonly modelId: string) { super(`Model not available: ${modelId}`); }
  protected override extras() { return { modelId: this.modelId }; }
}

export class PayloadTooLargeError extends AgentHostError {
  readonly httpStatus = 413;
  readonly errorType = "payload_too_large" as const;
  constructor(public readonly limitBytes: number, public readonly currentBytes: number) {
    super(`Workspace size cap exceeded (${currentBytes}/${limitBytes} bytes)`);
  }
  protected override extras() { return { limitBytes: this.limitBytes, currentBytes: this.currentBytes }; }
}

export class UpstreamFilesFetchError extends AgentHostError {
  readonly httpStatus = 502;
  readonly errorType = "upstream_files_fetch_failed" as const;
  constructor(public readonly fileId: string, public readonly status: number) {
    super(`Files API returned ${status} for file ${fileId}`);
  }
  protected override extras() { return { fileId: this.fileId, status: this.status }; }
}

export class UpstreamUrlFetchError extends AgentHostError {
  readonly httpStatus = 502;
  readonly errorType = "upstream_url_fetch_failed" as const;
  constructor(public readonly url: string, public readonly status: number) {
    super(`Remote URL fetch failed: ${url} → ${status}`);
  }
  protected override extras() { return { url: this.url, status: this.status }; }
}

export class UnsafeUrlError extends AgentHostError {
  readonly httpStatus = 400;
  readonly errorType = "unsafe_url" as const;
  constructor(public readonly url: string) { super(`URL refused (private/internal address): ${url}`); }
  protected override extras() { return { url: this.url }; }
}

export class AgentRunError extends AgentHostError {
  readonly httpStatus = 502;
  readonly errorType = "agent_error" as const;
}

export class AgentTimeoutError extends AgentHostError {
  readonly httpStatus = 504;
  readonly errorType = "agent_timeout" as const;
  constructor(message = "Agent took too long") { super(message); }
}
