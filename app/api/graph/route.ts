import { stableId } from "@/app/lib/graph-identity";
import { z } from "zod";
import { GraphResponse } from "@/app/lib/graph-schema";
import { graphCredentialsAvailable, graphFailure, withGraph } from "@/app/lib/neo4j-graph";
import { readGraphProof } from "@/app/lib/graph-proof";

const Input = z.object({ token: z.string().min(1).max(250000) }).strict();

export async function POST(request: Request) {
  const input = Input.safeParse(await request.json().catch(() => null));
  const proof = input.success ? readGraphProof(input.data.token) : undefined;
  if (!proof) return Response.json({ error: "Run discovery again to save a verified result." }, { status: 400 });
  if (!graphCredentialsAvailable()) return Response.json({ error: "Configure Neo4j to save accounts." }, { status: 503 });

  const { version, account } = proof;
  const criteria = JSON.stringify(version);
  const versionId = stableId("icp-version", criteria);
  const matchId = stableId("account-match", versionId, account.domain);
  const evidenceId = stableId("observation", matchId, account.url, account.excerpt);
  try {
    await withGraph(async (driver, options) => {
      const identities = [
        ["product", "AtlasProduct"], ["company", "AtlasCompany"], ["icp_version", "AtlasIcpVersion"],
        ["account_match", "AtlasAccountMatch"], ["observation", "AtlasObservation"],
      ] as const;
      for (const [constraint, label] of identities) {
        await driver.executeQuery(`CREATE CONSTRAINT atlas_${constraint}_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`, {}, options);
      }
      await driver.executeQuery(`
        MERGE (product:AtlasProduct {id: $productId})
        SET product.name = $productName
        MERGE (company:AtlasCompany {id: $domain})
        ON CREATE SET company.name = $company, company.domain = $domain
        MERGE (version:AtlasIcpVersion {id: $versionId})
        ON CREATE SET version.profileId = $profileId, version.approvedAt = $approvedAt,
                      version.criteria = $criteria, version.productName = $productName
        MERGE (match:AtlasAccountMatch {id: $matchId})
        ON CREATE SET match.inference = $inference, match.companyName = $company
        MERGE (evidence:AtlasObservation {id: $evidenceId})
        ON CREATE SET evidence.observation = $observation, evidence.category = $category,
                      evidence.url = $url, evidence.excerpt = $excerpt, evidence.retrievedAt = $retrievedAt
        MERGE (product)-[:HAS_ICP_VERSION]->(version)
        MERGE (version)-[:DISCOVERED_MATCH]->(match)
        MERGE (match)-[:MATCHES_COMPANY]->(company)
        MERGE (match)-[:SUPPORTED_BY]->(evidence)
      `, {
        ...account, productId: version.productId, productName: version.productName,
        profileId: version.profileId, approvedAt: version.approvedAt, criteria, versionId, matchId, evidenceId,
      }, options);
    });
    return Response.json({ matchId, evidenceId, versionId });
  } catch (error) {
    return Response.json({ error: graphFailure("save_account_match", error) }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("productId"));
  if (!id.success) return Response.json({ error: "Select a product to open its graph." }, { status: 400 });
  if (!graphCredentialsAvailable()) return Response.json({ error: "Configure Neo4j to load the knowledge graph." }, { status: 503 });

  try {
    const graph = await withGraph(async (driver, options) => {
      const accounts = await driver.executeQuery(`
        MATCH (:AtlasProduct {id: $productId})-[:HAS_ICP_VERSION]->(version:AtlasIcpVersion)
              -[:DISCOVERED_MATCH]->(match:AtlasAccountMatch)-[:MATCHES_COMPANY]->(company:AtlasCompany)
        MATCH (match)-[:SUPPORTED_BY]->(evidence:AtlasObservation)
        WITH version, match, company, collect(DISTINCT evidence {.*}) AS evidence
        CALL (company, version) {
          OPTIONAL MATCH (target:AtlasBuyerRoleMatch)-[:IDENTIFIES]->(person:AtlasPerson)-[employment:WORKS_AT]->(company)
          WHERE target.productId = $productId AND target.profileId = version.profileId AND target.approvedAt = version.approvedAt
          OPTIONAL MATCH (person)-[:EMPLOYMENT_EVIDENCE]->(source:AtlasEmploymentSource)-[:AT_COMPANY]->(company)
          WHERE source.role = employment.role
          WITH person, employment, source ORDER BY source.retrievedAt DESC
          WITH person, employment, head(collect(source)) AS source
          RETURN collect(CASE WHEN source IS NOT NULL THEN {
            id: person.id, name: person.name, role: employment.role,
            excerpt: source.excerpt, url: source.url, retrievedAt: source.retrievedAt
          } END) AS buyers
        }
        CALL (match) {
          OPTIONAL MATCH (match)-[:CHECKED_SOURCE]->(check:AtlasSignalCheck)
          RETURN collect(check { .url, .checkedAt, status: coalesce(check.status, "unconfirmed") }) AS checks
        }
        RETURN match.id AS id, coalesce(match.companyName, company.name) AS company, company.domain AS domain, match.inference AS inference,
               version.id AS versionId, version.profileId AS profileId, version.approvedAt AS approvedAt,
               version.productName AS productName, evidence, buyers, checks
        ORDER BY approvedAt DESC, id
      `, { productId: id.data }, options);
      const segments = await driver.executeQuery(`
        MATCH (capability:ProductCapability {productId: $productId})-[:ADDRESSES]->
            (pain:PainPoint {productId: $productId})-[fit:PROPOSED_IN]->(industry:NaicsIndustry)
        RETURN capability.name AS capability, pain.name AS painPoint, fit.segment AS segment,
               industry.code AS naics, fit.rationale AS rationale, fit.sources AS sources
        ORDER BY segment
      `, { productId: id.data }, options);
      return {
        matches: accounts.records.map((record) => record.toObject()),
        segments: segments.records.map((record) => record.toObject()),
      };
    });
    return Response.json(GraphResponse.parse(graph));
  } catch (error) {
    return Response.json({ error: graphFailure("read_product_graph", error) }, { status: 502 });
  }
}
