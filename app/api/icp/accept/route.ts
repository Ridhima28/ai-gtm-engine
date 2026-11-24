import { openAiFailure } from "@/app/lib/openai-error";
import { graphConfigured, graphCredentialsAvailable, graphFailure, withGraph } from "@/app/lib/neo4j-graph";
import OpenAI from "openai";
import { z } from "zod";
import { HypothesisSchema } from "@/app/lib/expansion-schema";
import naics from "@/app/lib/naics-2022.json";

const Acceptance = z.object({ productId: z.string().uuid(), hypothesis: HypothesisSchema });

export async function POST(request: Request) {
  const result = Acceptance.safeParse(await request.json().catch(() => null));
  if (!result.success) return Response.json({ error: "Invalid hypothesis." }, { status: 400 });
  const { productId, hypothesis } = result.data;
  const title = naics[hypothesis.naics as keyof typeof naics];
  if (!title) return Response.json({ error: "Unknown NAICS code." }, { status: 400 });

  if (!graphConfigured()) return Response.json({ graphSaved: false });
  if (!graphCredentialsAvailable() || !process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Neo4j or embedding credentials are incomplete. The ICP is unchanged." }, { status: 503 });
  }

  let stage = "embedding";
  try {
    const embedding = await new OpenAI({ timeout: 12000, maxRetries: 0 }).embeddings.create({
      model: "text-embedding-3-small",
      input: hypothesis.painPoint,
    });
    await withGraph(async (driver, options) => {
      stage = "pain_point_constraint";
      await driver.executeQuery(
        "CREATE CONSTRAINT atlas_pain_point IF NOT EXISTS FOR (p:PainPoint) REQUIRE (p.productId, p.name) IS UNIQUE",
        {}, options,
      );
      stage = "capability_constraint";
      await driver.executeQuery(
        "CREATE CONSTRAINT atlas_capability IF NOT EXISTS FOR (c:ProductCapability) REQUIRE (c.productId, c.name) IS UNIQUE",
        {}, options,
      );
      stage = "industry_constraint";
      await driver.executeQuery(
        "CREATE CONSTRAINT atlas_industry IF NOT EXISTS FOR (i:NaicsIndustry) REQUIRE i.code IS UNIQUE",
        {}, options,
      );
      stage = "vector_index";
      await driver.executeQuery(
        "CREATE VECTOR INDEX atlas_pain_points IF NOT EXISTS FOR (p:PainPoint) ON p.embedding OPTIONS {indexConfig: {`vector.dimensions`: 1536, `vector.similarity_function`: 'cosine'}}",
        {}, options,
      );
      stage = "persist_segment";
      await driver.executeQuery(
        "MERGE (cap:ProductCapability {productId: $productId, name: $capability}) " +
        "MERGE (pain:PainPoint {productId: $productId, name: $painPoint}) " +
        "SET pain.embedding = $embedding " +
        "MERGE (industry:NaicsIndustry {code: $naics}) SET industry.title = $title " +
        "MERGE (cap)-[:ADDRESSES]->(pain) " +
        "MERGE (pain)-[fit:PROPOSED_IN {segment: $segment}]->(industry) " +
        "SET fit.rationale = $rationale, fit.sources = $sources, fit.targetHeadcount = $targetHeadcount",
        { productId, capability: hypothesis.capability, painPoint: hypothesis.painPoint, naics: hypothesis.naics,
          segment: hypothesis.segment, rationale: hypothesis.rationale, title, targetHeadcount: hypothesis.targetHeadcount ?? null, embedding: embedding.data[0].embedding, sources: hypothesis.evidence.map(({ id }) => id) },
        options,
      );
    });
    return Response.json({ graphSaved: true });
  } catch (error) {
    const message = graphFailure(stage, error);
    const failure = openAiFailure(error, message);
    return Response.json({ error: `${failure.message} The ICP is unchanged.` }, { status: failure.status });
  }
}
