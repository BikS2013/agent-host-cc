import { promises as dns } from "node:dns";
import { UnsafeUrlError } from "../errors.js";

const isPrivateIPv4 = (ip: string): boolean => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

const isPrivateIPv6 = (ip: string): boolean => {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
  return false;
};

export const assertSafeUrl = async (raw: string): Promise<void> => {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrlError(raw); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError(raw);
  // Direct IP literal in hostname
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) throw new UnsafeUrlError(raw);
  // Resolve and check all returned addresses
  let addrs: { address: string; family: number }[];
  try { addrs = await dns.lookup(host, { all: true }); }
  catch { throw new UnsafeUrlError(raw); }
  for (const a of addrs) {
    if (a.family === 4 && isPrivateIPv4(a.address)) throw new UnsafeUrlError(raw);
    if (a.family === 6 && isPrivateIPv6(a.address)) throw new UnsafeUrlError(raw);
  }
};
