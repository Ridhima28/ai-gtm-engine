import "server-only";
import { z } from "zod";
import { PublicSourceUrl } from "./discovery-schema";

const SearchResults = z.object({
  results: z.array(z.object({ url: z.string(), title: z.string(), raw_content: z.string().nullish() })),
});
export function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function hostname(url: string) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

export async function searchTavily(query: string, key: string, includeDomains?: string[]) {
  const profileSearch = includeDomains?.length === 1 && includeDomains[0] === "linkedin.com";
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query, include_domains: includeDomains, max_results: 8, include_raw_content: "text", search_depth: "basic",
      exclude_domains: profileSearch ? undefined : ["indeed.com", "linkedin.com", "glassdoor.com", "ziprecruiter.com", "builtin.com", "jooble.org", "simplyhired.com", "monster.com", "talent.com"],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Tavily request failed");
  const { results } = SearchResults.parse(await response.json());
  const retrievedAt = new Date().toISOString();
  return results.flatMap(({ url, title, raw_content }) => {
    if (!raw_content || !PublicSourceUrl.safeParse(url).success) return [];
    return [{ url, title, text: normalizeSpace(raw_content).slice(0, 10000), retrievedAt, kind: "web" as const }];
  });
}

export function uniquePages(pages: Awaited<ReturnType<typeof searchTavily>>) {
  return [...new Map(pages.map((page) => [page.url, page])).values()];
}

export function belongsToDomain(url: string, domain: string) {
  const host = hostname(url);
  return host === domain || host.endsWith(`.${domain}`);
}

export async function findTavilyPages(query: string, key: string) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query, max_results: 7, search_depth: "basic", include_raw_content: false,
      exclude_domains: ["indeed.com", "linkedin.com", "glassdoor.com", "ziprecruiter.com", "builtin.com", "jooble.org", "simplyhired.com", "monster.com", "talent.com", "governmentjobs.com", "remote.com", "remoterocketship.com", "dailyremote.com", "youtube.com", "facebook.com"],
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Tavily search failed");
  return SearchResults.parse(await response.json()).results.filter(({ url }) => PublicSourceUrl.safeParse(url).success);
}

const Extractions = z.object({ results: z.array(z.object({ url: z.string(), raw_content: z.string() })) });

export async function extractTavilyPages(pages: { url: string; title: string }[], key: string) {
  const response = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ urls: pages.map(({ url }) => url), format: "text", extract_depth: "basic", timeout: 8 }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Tavily evidence extraction failed");
  const titles = new Map(pages.map(({ url, title }) => [url, title]));
  const retrievedAt = new Date().toISOString();
  return Extractions.parse(await response.json()).results.flatMap(({ url, raw_content }) => {
    if (!titles.has(url) || !raw_content.trim()) return [];
    return [{ url, title: titles.get(url)!, text: normalizeSpace(raw_content).slice(0, 50000), retrievedAt, kind: "web" as const }];
  });
}
