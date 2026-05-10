import { describe, expect, it } from "vitest";
import { assertSafeUrl } from "../../src/attachmentProcessor/ssrfGuard.js";
import { UnsafeUrlError } from "../../src/errors.js";

describe("ssrfGuard", () => {
  it.each([
    "ftp://x", "javascript:alert(1)", "file:///etc/passwd",
  ])("rejects non-http(s) scheme: %s", async u => {
    await expect(assertSafeUrl(u)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it.each([
    "http://127.0.0.1/", "http://10.0.0.1/", "http://172.16.0.1/",
    "http://192.168.1.1/", "http://169.254.169.254/", "http://[::1]/",
  ])("rejects private IP: %s", async u => {
    await expect(assertSafeUrl(u)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it("accepts a public hostname", async () => {
    await expect(assertSafeUrl("https://example.com/path")).resolves.toBeUndefined();
  });
});
