import "server-only";
import type { z } from "zod";
import type { BuyerRequestSchema, BuyerResultSchema, CompetitionResultSchema } from "./research-schema";
import { graphConfigured, graphFailure, withGraph } from "./neo4j-graph";
import { stableId } from "./graph-identity";

export async function persistBuyers(company: string, domain: string, people: z.infer<typeof BuyerResultSchema>["people"], scope?: z.infer<typeof BuyerRequestSchema>["scope"]) {
  if (!graphConfigured() || !people.length) return;
  try {
    await withGraph(async (driver, options) => {
      await driver.executeQuery("CREATE CONSTRAINT atlas_person_id IF NOT EXISTS FOR (n:AtlasPerson) REQUIRE n.id IS UNIQUE", {}, options);
      await driver.executeQuery("CREATE CONSTRAINT atlas_company_id IF NOT EXISTS FOR (n:AtlasCompany) REQUIRE n.id IS UNIQUE", {}, options);
      await driver.executeQuery("CREATE CONSTRAINT atlas_employment_source_id IF NOT EXISTS FOR (n:AtlasEmploymentSource) REQUIRE n.id IS UNIQUE", {}, options);
      await driver.executeQuery("CREATE CONSTRAINT atlas_buyer_role_match_id IF NOT EXISTS FOR (n:AtlasBuyerRoleMatch) REQUIRE n.id IS UNIQUE", {}, options);
      await driver.executeQuery(`
        MERGE (company:AtlasCompany {id: $domain})
        ON CREATE SET company.name = $company, company.domain = $domain
        UNWIND $people AS item
        MERGE (person:AtlasPerson {id: item.id})
        ON CREATE SET person.name = item.name
        MERGE (person)-[employment:WORKS_AT]->(company)
        SET employment.role = CASE WHEN employment.retrievedAt IS NULL OR employment.retrievedAt < item.retrievedAt THEN item.role ELSE employment.role END,
            employment.retrievedAt = CASE WHEN employment.retrievedAt IS NULL OR employment.retrievedAt < item.retrievedAt THEN item.retrievedAt ELSE employment.retrievedAt END
        MERGE (source:AtlasEmploymentSource {id: item.sourceId})
        ON CREATE SET source.role = item.role, source.url = item.url, source.excerpt = item.excerpt, source.retrievedAt = item.retrievedAt
        MERGE (person)-[:EMPLOYMENT_EVIDENCE]->(source)
        MERGE (source)-[:AT_COMPANY]->(company)
        FOREACH (_ IN CASE WHEN item.targetId IS NULL THEN [] ELSE [1] END |
          MERGE (target:AtlasBuyerRoleMatch {id: item.targetId})
          ON CREATE SET target.productId = $scope.productId, target.profileId = $scope.profileId,
                        target.approvedAt = $scope.approvedAt, target.targetRole = item.targetRole
          MERGE (target)-[:IDENTIFIES]->(person)
        )
      `, {
        company, domain, scope: scope ?? null, people: people.map((person) => {
          const id = stableId("person-at-company", domain, person.name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "));
          return { ...person, id, targetId: scope ? stableId("buyer-role-match", scope.productId, scope.profileId, scope.approvedAt, id, person.targetRole) : null, sourceId: stableId("employment-evidence", id, person.role, person.url, person.excerpt) };
        }),
      }, options);
    });
  } catch (error) {
    return graphFailure("persist_verified_buyers", error);
  }
}

export async function persistCompetitors(productName: string, result: z.infer<typeof CompetitionResultSchema>) {
  if (!graphConfigured() || !result.competitors.length) return;
  try {
    await withGraph(async (driver, options) => {
      for (const [name, label] of [["product", "AtlasProduct"], ["competitor", "AtlasCompetitor"], ["competition_research", "AtlasCompetitionResearch"]]) {
        await driver.executeQuery(`CREATE CONSTRAINT atlas_${name}_id IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`, {}, options);
      }
      await driver.executeQuery(`
        MERGE (product:AtlasProduct {id: $productId})
        ON CREATE SET product.name = $productName
        UNWIND $competitors AS item
        MERGE (competitor:AtlasCompetitor {id: item.domain})
        ON CREATE SET competitor.name = item.name
        MERGE (product)-[relationship:COMPETES_WITH]->(competitor)
        SET relationship.category = item.category, relationship.rationale = item.rationale
        MERGE (research:AtlasCompetitionResearch {id: item.researchId})
        ON CREATE SET research.category = item.category, research.rationale = item.rationale, research.claims = item.claims
        MERGE (product)-[:HAS_COMPETITOR_RESEARCH]->(research)-[:ABOUT_COMPETITOR]->(competitor)
      `, {
        productName, productId: result.productId, competitors: result.competitors.map((item) => ({
          domain: item.domain, name: item.name, category: item.category, rationale: item.classificationInference,
          claims: JSON.stringify(item.claims),
          researchId: stableId("competition-research", result.productId, item.domain, item.category, item.classificationInference,
            JSON.stringify(item.claims.map(({ kind, url, excerpt, observation }) => [kind, url, excerpt, observation]).sort())),
        })),
      }, options);
    });
  } catch (error) {
    return graphFailure("persist_competitor_research", error);
  }
}
