import { z } from "zod";
import { HypothesisSchema } from "./expansion-schema";

const Work = HypothesisSchema.shape.evidence.element;

export class OpenAlexHttpError extends Error {
  constructor(readonly status: number) {
    super("OpenAlex lookup failed");
  }
}

export async function research(query: string, { years = 3, signal }: { years?: number; signal?: AbortSignal } = {}) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "5");
  url.searchParams.set("filter", `from_publication_date:${new Date().getUTCFullYear() - years}-01-01`);
  url.searchParams.set("select", "id,title,publication_year,abstract_inverted_index");
  const key = process.env.OPENALEX_API_KEY;
  const response = await fetch(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new OpenAlexHttpError(response.status);
  const payload = z.object({ results: z.array(z.object({
    id: Work.shape.id.regex(/^https:\/\/openalex\.org\/W\d+$/),
    title: z.string(),
    publication_year: z.number().nullable(),
    abstract_inverted_index: z.record(z.string(), z.array(z.number().int().min(0).max(10000))).nullish(),
  })) }).parse(await response.json());
  return payload.results.map((work) => {
    const words: string[] = [];
    for (const [word, positions] of Object.entries(work.abstract_inverted_index ?? {})) {
      for (const position of positions) words[position] = word;
    }
    return { id: work.id, title: work.title, year: work.publication_year, abstract: words.join(" ").slice(0, 2400) };
  });
}

export async function corroborateIndustries(industries: string[], capabilities: string[]) {
  const terms = capabilities.map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 6).slice(0, 5);
  if (!terms.length || !industries.length || industries.length > 5) return [];

  const results = await Promise.allSettled(industries.map(async (industry) => {
    const label = industry.trim().toLowerCase();
    if (label.length < 4) return undefined;
    const papers = await research(label);
    const paper = papers.find(({ title, abstract }) => {
      const content = `${title} ${abstract}`.toLowerCase();
      return content.includes(label) && terms.some((term) => content.includes(term));
    });
    return paper ? { industry, id: paper.id, title: paper.title, year: paper.year } : undefined;
  }));
  return results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}
