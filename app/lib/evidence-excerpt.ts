const typography: Record<string, string> = {
  "‘": "'", "’": "'", "‛": "'", "“": '"', "”": '"', "„": '"',
  "‐": "-", "‑": "-", "–": "-", "—": "-", "−": "-",
};

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function literalPattern(value: string) {
  return value.replace(/[‘’‛“”„‐‑–—−]/g, (character) => typography[character]);
}

function escapedPattern(value: string) {
  return literalPattern(normalize(value)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sourceExcerpt(text: string, quote: string) {
  const source = normalize(text);
  const requested = normalize(quote);
  if (!requested) return;
  if (source.includes(requested)) return requested;
  const found = new RegExp(escapedPattern(requested), "i").exec(literalPattern(source));
  return found ? source.slice(found.index, found.index + found[0].length) : undefined;
}

export function sourceSpan(text: string, name: string, title: string) {
  const source = normalize(text);
  const names = escapedPattern(name);
  const titles = escapedPattern(title);
  const between = "[^.!?]{0,65}?";
  const match = new RegExp(`(?:${names}${between}${titles}|${titles}${between}${names})`, "i").exec(literalPattern(source));
  return match ? source.slice(match.index, match.index + match[0].length) : undefined;
}
