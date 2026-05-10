import { describe, expect, it } from "vitest";
import { extractUrls } from "../../src/attachmentProcessor/urlDetector.js";

describe("urlDetector.extractUrls", () => {
  it("finds plain http and https URLs", () => {
    expect(extractUrls("see https://a.com and http://b.org/x"))
      .toEqual(["https://a.com", "http://b.org/x"]);
  });
  it("ignores URLs inside fenced code blocks", () => {
    const text = "before\n```\nhttps://hidden.com\n```\nafter https://shown.com";
    expect(extractUrls(text)).toEqual(["https://shown.com"]);
  });
  it("ignores URLs inside inline code spans", () => {
    expect(extractUrls("`https://nope.com` and https://yes.com"))
      .toEqual(["https://yes.com"]);
  });
  it("dedupes identical URLs", () => {
    expect(extractUrls("https://x.com https://x.com")).toEqual(["https://x.com"]);
  });
});
