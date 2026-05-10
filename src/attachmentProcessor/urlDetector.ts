const URL_RE = /(?<![`])\bhttps?:\/\/[^\s)`<>]+/g;

const stripCodeRegions = (s: string): string => {
  let out = s.replace(/```[\s\S]*?```/g, "");
  out = out.replace(/`[^`\n]*`/g, "");
  return out;
};

export const extractUrls = (text: string): string[] => {
  const cleaned = stripCodeRegions(text);
  const matches = cleaned.match(URL_RE) ?? [];
  return Array.from(new Set(matches.map(m => m.replace(/[.,;:!?)]+$/, ""))));
};
