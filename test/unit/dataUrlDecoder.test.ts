import { describe, expect, it } from "vitest";
import { decodeDataUrl, isDataUrl } from "../../src/attachmentProcessor/dataUrlDecoder.js";

describe("dataUrlDecoder", () => {
  it("isDataUrl returns true for valid data URL", () => {
    expect(isDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isDataUrl("https://x")).toBe(false);
  });
  it("decodes base64 image data URL → Buffer + mime + extension", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const r = decodeDataUrl(`data:image/png;base64,${png}`);
    expect(r.mime).toBe("image/png");
    expect(r.extension).toBe("png");
    expect(r.bytes.length).toBe(4);
  });
  it("decodes application/pdf data URL → pdf extension", () => {
    const r = decodeDataUrl("data:application/pdf;base64," + Buffer.from("x").toString("base64"));
    expect(r.extension).toBe("pdf");
  });
  it("throws on non-base64 data URL", () => {
    expect(() => decodeDataUrl("data:text/plain,hello")).toThrow();
  });
});
