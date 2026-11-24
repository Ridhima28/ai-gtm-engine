import "server-only";

export function researchTrace(request: Request) {
  const enabled = process.env.NODE_ENV === "development" && request.headers.get("x-atlas-discovery-trace") === "1";
  const start = performance.now();
  const timings: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const rejects: string[] = [];
  const providers: string[] = [];

  return {
    counts, rejects, providers,
    record(stage: string, began: number) {
      timings[stage] = (timings[stage] ?? 0) + Math.round(performance.now() - began);
    },
    respond(data: object, status = 200) {
      return Response.json(enabled ? { ...data, trace: {
        ...counts, rejects, providers, timings: { ...timings, totalMs: Math.round(performance.now() - start) },
      } } : data, { status });
    },
  };
}

export type ResearchTrace = ReturnType<typeof researchTrace>;

export async function collectSearches<T>(requests: Promise<T[]>[], trace: ResearchTrace, provider: string) {
  const results = await Promise.allSettled(requests);
  for (const result of results) {
    if (result.status === "rejected") trace.providers.push(provider);
  }
  if (results.length && results.every((result) => result.status === "rejected")) {
    throw new Error("Search provider unavailable");
  }
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}
