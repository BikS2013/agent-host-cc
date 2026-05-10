import { describe, expect, it } from "vitest";
import {
  AgentHostError,
  ConfigurationError,
  UnauthorizedError,
  InvalidRequestError,
  ModelNotFoundError,
  PayloadTooLargeError,
  UpstreamFilesFetchError,
  UpstreamUrlFetchError,
  UnsafeUrlError,
  AgentRunError,
  AgentTimeoutError,
} from "../../src/errors.js";

describe("AgentHostError taxonomy", () => {
  it("ConfigurationError carries variable name and HTTP status 500", () => {
    const e = new ConfigurationError("FOO");
    expect(e).toBeInstanceOf(AgentHostError);
    expect(e.varName).toBe("FOO");
    expect(e.httpStatus).toBe(500);
    expect(e.errorType).toBe("configuration");
  });

  it("UnauthorizedError → 401 / unauthorized", () => {
    expect(new UnauthorizedError().httpStatus).toBe(401);
    expect(new UnauthorizedError().errorType).toBe("unauthorized");
  });

  it("InvalidRequestError carries Zod issues → 422 / invalid_request", () => {
    const e = new InvalidRequestError("bad", [{ path: ["a"], message: "x" }]);
    expect(e.httpStatus).toBe(422);
    expect(e.issues).toEqual([{ path: ["a"], message: "x" }]);
  });

  it("ModelNotFoundError → 404 / model_not_found", () => {
    expect(new ModelNotFoundError("x").httpStatus).toBe(404);
  });

  it("PayloadTooLargeError carries limit + current → 413", () => {
    const e = new PayloadTooLargeError(1, 2);
    expect(e.httpStatus).toBe(413);
    expect(e.limitBytes).toBe(1);
    expect(e.currentBytes).toBe(2);
  });

  it("UpstreamFilesFetchError → 502", () => {
    expect(new UpstreamFilesFetchError("id", 500).httpStatus).toBe(502);
  });

  it("UpstreamUrlFetchError → 502", () => {
    expect(new UpstreamUrlFetchError("u", 500).httpStatus).toBe(502);
  });

  it("UnsafeUrlError → 400", () => {
    expect(new UnsafeUrlError("http://10.0.0.1").httpStatus).toBe(400);
  });

  it("AgentRunError → 502", () => {
    expect(new AgentRunError("boom").httpStatus).toBe(502);
  });

  it("AgentTimeoutError → 504", () => {
    expect(new AgentTimeoutError().httpStatus).toBe(504);
  });

  it("toErrorEnvelope() returns the documented JSON shape", () => {
    const e = new InvalidRequestError("nope", [{ path: ["x"], message: "y" }]);
    expect(e.toErrorEnvelope()).toEqual({
      error: { type: "invalid_request", message: "nope", issues: [{ path: ["x"], message: "y" }] },
    });
  });
});
