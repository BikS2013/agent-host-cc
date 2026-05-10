// @vitest-environment jsdom
//
// Unit tests for chat-ui/client/src/lib/api.ts
//
// Scope: typed REST wrappers — getProfiles, createProfile, updateProfile,
// deleteProfile, activateProfile. All tests mock global `fetch`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  activateProfile,
} from "../../client/src/lib/api.js";
import { ApiError } from "../../client/src/lib/types.js";
import type {
  ProfilesListResponse,
  RedactedProfile,
  CreateProfileInput,
  UpdateProfileInput,
} from "../../client/src/lib/types.js";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const sampleProfile: RedactedProfile = {
  id: "uuid-1",
  name: "local-agent",
  backendKind: "agent-host-cc",
  baseUrl: "http://localhost:8000",
  apiKey: "<redacted>",
  defaultModel: "cc.claude-sonnet-4-6",
} as RedactedProfile;

const profilesListResponse: ProfilesListResponse = {
  activeProfileId: "uuid-1",
  profiles: [sampleProfile],
};

/** Helper: create a 200 Response with a JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Helper: create a non-2xx Response with the standard error envelope. */
function errorResponse(
  status: number,
  type: string,
  message: string,
  issues?: Array<{ path: Array<string | number>; message: string }>,
): Response {
  const envelope = { error: { type, message, ...(issues ? { issues } : {}) } };
  return new Response(JSON.stringify(envelope), {
    status,
    statusText: "Error",
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("api / getProfiles", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes a GET request to /api/profiles and returns parsed JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(profilesListResponse));

    const result = await getProfiles();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/profiles");
    expect(init.method).toBe("GET");

    expect(result.activeProfileId).toBe("uuid-1");
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]!.name).toBe("local-agent");
  });

  it("throws ApiError on non-2xx response with server error body", async () => {
    // Use mockImplementation so each call gets a fresh Response (body is not reused).
    vi.mocked(fetch).mockImplementation(async () =>
      errorResponse(403, "forbidden", "Access denied"),
    );

    let caught: unknown;
    try {
      await getProfiles();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(403);
    expect(apiErr.type).toBe("forbidden");
    expect(apiErr.message).toMatch(/Access denied/);
  });
});

describe("api / createProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes a POST request to /api/profiles with JSON body and correct content-type", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(sampleProfile, 201));

    const input: CreateProfileInput = {
      name: "local-agent",
      backendKind: "agent-host-cc",
      baseUrl: "http://localhost:8000",
      apiKey: "test-key",
      defaultModel: "cc.claude-sonnet-4-6",
    };

    const result = await createProfile(input);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/profiles");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    // Body must be JSON.stringify of the input
    expect(JSON.parse(init.body as string)).toEqual(input);

    expect(result.id).toBe("uuid-1");
    expect(result.name).toBe("local-agent");
  });

  it("throws ApiError with validation issues on 422", async () => {
    const issues = [
      { path: ["apiKey"], message: "Required field missing" },
    ];
    // Use mockImplementation so each call gets a fresh Response.
    vi.mocked(fetch).mockImplementation(async () =>
      errorResponse(422, "invalid_profile", "Validation failed", issues),
    );

    const badInput = {
      name: "bad",
      backendKind: "agent-host-cc" as const,
      baseUrl: "http://localhost",
      apiKey: "",
      defaultModel: "cc.claude-sonnet-4-6",
    };

    let caught: unknown;
    try {
      await createProfile(badInput);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(422);
    expect(apiErr.issues).toBeDefined();
    expect(apiErr.issues![0]!.path).toContain("apiKey");
  });
});

describe("api / updateProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes a PUT request to /api/profiles/:id with JSON body", async () => {
    const updatedProfile: RedactedProfile = {
      ...sampleProfile,
      name: "local-agent-updated",
    } as RedactedProfile;
    vi.mocked(fetch).mockResolvedValue(jsonResponse(updatedProfile));

    const input: UpdateProfileInput = {
      id: "uuid-1",
      name: "local-agent-updated",
      backendKind: "agent-host-cc",
      baseUrl: "http://localhost:8000",
      apiKey: "<redacted>",
      defaultModel: "cc.claude-sonnet-4-6",
    };

    const result = await updateProfile("uuid-1", input);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/profiles/uuid-1");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual(input);

    expect(result.name).toBe("local-agent-updated");
  });

  it("throws ApiError (client-side) when body.id does not match URL id", async () => {
    const input: UpdateProfileInput = {
      id: "uuid-DIFFERENT",
      name: "mismatch",
      backendKind: "agent-host-cc",
      baseUrl: "http://localhost",
      apiKey: "key",
      defaultModel: "cc.model",
    };

    await expect(updateProfile("uuid-1", input)).rejects.toThrow(ApiError);

    // fetch should NOT have been called — early client-side guard
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws ApiError on non-2xx server response", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      errorResponse(404, "not_found", "Profile not found"),
    );

    const input: UpdateProfileInput = {
      id: "uuid-missing",
      name: "ghost",
      backendKind: "openai",
      baseUrl: "https://api.openai.com",
      apiKey: "<redacted>",
      defaultModel: "gpt-4o",
    };

    let caught: unknown;
    try {
      await updateProfile("uuid-missing", input);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.message).toMatch(/Profile not found/i);
  });
});

describe("api / deleteProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes a DELETE request to /api/profiles/:id and resolves void on 204", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, { status: 204, statusText: "No Content" }),
    );

    await expect(deleteProfile("uuid-1")).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/profiles/uuid-1");
    expect(init.method).toBe("DELETE");
  });

  it("URL-encodes the profile id in the DELETE path", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await deleteProfile("uuid with spaces");

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("/api/profiles/uuid%20with%20spaces");
  });

  it("throws ApiError on non-2xx response", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      errorResponse(404, "not_found", "Profile uuid-ghost does not exist"),
    );

    let caught: unknown;
    try {
      await deleteProfile("uuid-ghost");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.message).toMatch(/uuid-ghost/);
  });
});

describe("api / activateProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes a POST request to /api/profiles/:id/activate and returns activeProfileId", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ activeProfileId: "uuid-1" }),
    );

    const result = await activateProfile("uuid-1");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/profiles/uuid-1/activate");
    expect(init.method).toBe("POST");

    expect(result.activeProfileId).toBe("uuid-1");
  });

  it("URL-encodes the profile id in the activate path", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ activeProfileId: "uuid-special" }),
    );

    await activateProfile("uuid/special");

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("/api/profiles/uuid%2Fspecial/activate");
  });

  it("throws ApiError with useful message on non-2xx", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      errorResponse(404, "not_found", "Profile uuid-ghost does not exist"),
    );

    let caught: unknown;
    try {
      await activateProfile("uuid-ghost");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.type).toBe("not_found");
    // Message must be useful — should include status or server error string
    expect(apiErr.message).toMatch(/uuid-ghost|not found/i);
  });

  it("error message includes HTTP status when response is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Gateway Timeout", {
        status: 504,
        statusText: "Gateway Timeout",
        headers: { "Content-Type": "text/plain" },
      }),
    );

    try {
      await activateProfile("uuid-1");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(504);
      // Message should contain the status text or code
      expect(apiErr.message).toMatch(/504|Gateway Timeout|Gateway Timeout/i);
    }
  });
});
