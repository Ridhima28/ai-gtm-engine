import { z } from "zod";
import { refreshSignals } from "@/app/lib/graph-signal-refresh";
import { graphCredentialsAvailable, graphFailure } from "@/app/lib/neo4j-graph";

const Input = z.object({ productId: z.uuid() }).strict();

export async function POST(request: Request) {
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Select a product to refresh its signals." }, { status: 400 });
  if (!graphCredentialsAvailable() || !process.env.TAVILY_API_KEY?.trim()) {
    return Response.json({ error: "Configure Neo4j and Tavily to refresh signals." }, { status: 503 });
  }
  try {
    return Response.json(await refreshSignals(input.data.productId));
  } catch (error) {
    return Response.json({ error: graphFailure("manual_signal_refresh", error) }, { status: 502 });
  }
}
