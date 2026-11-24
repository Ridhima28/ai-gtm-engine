import { hostname } from "./market-search";

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const stop = new Set(["the", "and", "with", "for", "are", "from", "this", "that"]);

export function isEmployerPage(url: string) {
  const page = new URL(url);
  return /(?:^|[.-])(?:jobs|careers)(?:[.-]|$)/i.test(page.hostname) ||
    /\/(?:jobs?|careers|job-description|vacancies)(?:[/-]|$)/i.test(page.pathname);
}

export function isEditorialPage(url: string) {
  return /\/(?:blog|resources|guides|compare|alternative)(?:[/-]|$)/i.test(new URL(url).pathname);
}

export function rankDiscoveryPages(pages: { url: string; title: string }[]) {
  const unique = [...new Map(pages.map((page) => [page.url, page])).values()];
  const counts = new Map<string, number>();
  return unique.sort((a, b) => Number(isEmployerPage(b.url)) - Number(isEmployerPage(a.url))).filter(({ url }) => {
    const domain = hostname(url);
    const count = counts.get(domain) ?? 0;
    if (count >= 2) return false;
    counts.set(domain, count + 1);
    return true;
  }).slice(0, 14);
}

export function selectPassages(text: string, criteria: string[]) {
  const terms = new Set(criteria.join(" ").toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((term) => !stop.has(term)));
  const fragments = [...segmenter.segment(text)].flatMap(({ segment }) => {
    const trimmed = segment.trim();
    if (trimmed.length <= 420) return [trimmed];
    const words = [...trimmed.matchAll(/\S+/g)];
    const windows: string[] = [];
    let start = 0;
    while (start < words.length) {
      const from = words[start].index;
      let end = start;
      while (end + 1 < words.length && words[end + 1].index + words[end + 1][0].length - from <= 380) end++;
      windows.push(trimmed.slice(from, Math.min(from + 380, words[end].index + words[end][0].length)));
      if (end === words.length - 1) break;
      start = Math.max(start + 1, end - 7);
    }
    return windows;
  });
  return [...new Set(fragments)].filter((fragment) => fragment.length >= 25 && fragment.length <= 420)
    .map((excerpt) => ({
      excerpt,
      rank: new Set((excerpt.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((word) => terms.has(word))).size,
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 9)
    .map(({ excerpt }) => excerpt);
}
