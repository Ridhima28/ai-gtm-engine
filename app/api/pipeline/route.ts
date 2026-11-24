import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PipelineResponse, StageChange } from "@/app/lib/pipeline-schema";
import { graphCredentialsAvailable, graphFailure, withGraph } from "@/app/lib/neo4j-graph";
import { OutreachMatch, readOutreachHistory } from "@/app/lib/outreach-graph";

export async function GET(request: Request) {
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("productId"));
  if (!id.success) return Response.json({ error: "Select a product to load its pipeline." }, { status: 400 });
  if (!graphCredentialsAvailable()) return Response.json({ error: "Configure Neo4j to load the pipeline." }, { status: 503 });
  try {
    const result = await withGraph(async (driver, options) => {
      const { records } = await driver.executeQuery(`
        MATCH (:AtlasProduct {id: $productId})-[:HAS_ICP_VERSION]->(:AtlasIcpVersion)-[:DISCOVERED_MATCH]->(match:AtlasAccountMatch)
        OPTIONAL MATCH (match)-[:HAS_STAGE_EVENT]->(event:AtlasPipelineEvent)
        WITH match, event ORDER BY event.at DESC, event.id
        RETURN match.id AS id, coalesce(match.pipelineStage, "Matched") AS stage,
               collect(event { .id, .previous, .stage, .at, .actor }) AS changes
      `, { productId: id.data }, options);
      return PipelineResponse.parse({ leads: records.map((record) => record.toObject()),
        outreach: await readOutreachHistory(driver, options, id.data) });
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: graphFailure("load_pipeline", error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const change = StageChange.safeParse(await request.json().catch(() => null));
  if (!change.success || change.data.previous === change.data.stage) {
    return Response.json({ error: "Choose a different stage and enter your name." }, { status: 400 });
  }
  if (!graphCredentialsAvailable()) return Response.json({ error: "Configure Neo4j to update the pipeline." }, { status: 503 });
  try {
    const updated = await withGraph(async (driver, options) => {
      const { records } = await driver.executeQuery(OutreachMatch + `
        SET match.pipelineLock = coalesce(match.pipelineLock, 0) + 1
        WITH match WHERE coalesce(match.pipelineStage, "Matched") = $previous
        SET match.pipelineStage = $stage
        CREATE (match)-[:HAS_STAGE_EVENT]->(event:AtlasPipelineEvent)
        SET event = $event
        RETURN event {.*} AS change
      `, { ...change.data, event: { id: randomUUID(), previous: change.data.previous, stage: change.data.stage,
        actor: change.data.actor, at: new Date().toISOString() } }, options);
      return records[0]?.get("change");
    });
    return updated ? Response.json(updated) : Response.json({ error: "This match or its stage changed. Reload the pipeline." }, { status: 409 });
  } catch (error) {
    return Response.json({ error: graphFailure("update_pipeline_stage", error) }, { status: 502 });
  }
}
