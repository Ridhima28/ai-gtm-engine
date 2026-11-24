import { persistBuyers } from "@/app/lib/graph-research";
import { discoverBuyers } from "@/app/lib/buyer-discovery";
import { BuyerRequestSchema, BuyerResultSchema } from "@/app/lib/research-schema";
import { openAiFailure } from "@/app/lib/openai-error";

import { researchTrace } from "@/app/lib/research-trace";

export async function POST(request: Request) {
  const trace = researchTrace(request);
  const input = BuyerRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Select a company and provide target roles." }, { status: 400 });
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key || !process.env.OPENAI_API_KEY) return Response.json({ error: "Buyer research is unavailable on this server." }, { status: 503 });

  const { company, domain } = input.data;
  try {
    const result = await discoverBuyers(input.data, key, trace);
    const saving = performance.now();
    const graphWarning = await persistBuyers(company, domain, result.people, input.data.scope);
    trace.record("graphSaveMs", saving);
    return trace.respond(BuyerResultSchema.parse({ ...result, graphWarning }));
  } catch (error) {
    const failure = openAiFailure(error, "Buyer research could not be completed. Try again.");
    return trace.respond({ error: failure.message }, failure.status);
  }
}
