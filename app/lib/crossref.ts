import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { ResearchWorkSchema } from "./expansion-schema";

const CrossrefResults = z.object({ message: z.object({ items: z.array(z.unknown()) }) });
const CrossrefWork = z.object({
  DOI: z.string().regex(/^10\.\d{4,}\/\S+$/),
  title: z.array(z.string()).min(1),
  published: z.object({ "date-parts": z.array(z.array(z.number())) }).optional(),
  abstract: z.string(),
});

export class CrossrefHttpError extends Error {
  constructor(readonly status: number) {
    super("Crossref lookup failed");
  }
}

// Crossref's public pool allows one request per second and one in flight.
let queue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;

export function searchCrossref(query: string, { years = 3, signal }: { years?: number; signal?: AbortSignal } = {}) {
  const search = queue.then(() => fetchCrossref(query, years, signal));
  queue = search.catch(() => undefined);
  return search;
}

async function requestCrossref(url: URL, signal?: AbortSignal) {
  await delay(Math.max(0, nextRequestAt - Date.now()), undefined, { signal });
  nextRequestAt = Date.now() + 1100;
  return fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
}

async function fetchCrossref(query: string, years: number, signal?: AbortSignal) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("filter", `from-pub-date:${new Date().getUTCFullYear() - years}-01-01,has-abstract:1`);
  url.searchParams.set("select", "DOI,title,published,abstract");
  url.searchParams.set("rows", "5");
  let response = await requestCrossref(url, signal);
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 1);
    if (Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 3) {
      await response.body?.cancel();
      nextRequestAt = Math.max(nextRequestAt, Date.now() + retryAfter * 1000);
      response = await requestCrossref(url, signal);
    }
  }
  if (!response.ok) throw new CrossrefHttpError(response.status);
  const { message: { items } } = CrossrefResults.parse(await response.json());
  return items.flatMap((item) => {
    const parsed = CrossrefWork.safeParse(item);
    if (!parsed.success) return [];
    const work = parsed.data;
    const abstract = work.abstract.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2400);
    const source = ResearchWorkSchema.safeParse({
      id: `https://doi.org/${work.DOI.split("/").map(encodeURIComponent).join("/")}`,
      title: work.title[0].trim(),
      year: work.published?.["date-parts"][0]?.[0] ?? null,
    });
    return source.success && source.data.title && abstract ? [{ ...source.data, abstract }] : [];
  });
}
