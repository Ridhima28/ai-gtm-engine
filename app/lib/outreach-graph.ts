import "server-only";
import { OutreachContact, OutreachHistoryItem } from "./outreach-schema";
import { z } from "zod";

type QueryRunner = {
  executeQuery: import("neo4j-driver").Driver["executeQuery"];
};

export const OutreachMatch = `
  MATCH (product:AtlasProduct {id: $productId})-[:HAS_ICP_VERSION]->(version:AtlasIcpVersion)
        -[:DISCOVERED_MATCH]->(match:AtlasAccountMatch {id: $matchId})
`;

export async function readMatchTarget(driver: QueryRunner, options: { database?: string }, params: { productId: string; matchId: string }) {
  const { records } = await driver.executeQuery(OutreachMatch + `
    MATCH (match)-[:MATCHES_COMPANY]->(company:AtlasCompany)
    RETURN coalesce(match.companyName, company.name) AS company, company.domain AS domain, version.criteria AS criteria
  `, params, options);
  const row = records[0]?.toObject();
  if (!row) return;
  const criteriaSchema = z.string().transform((value, ctx) => {
    try { return JSON.parse(value) as unknown; }
    catch { ctx.addIssue({ code: "custom", message: "Invalid saved ICP criteria" }); return z.NEVER; }
  }).pipe(z.object({ buyerRoles: z.array(z.string().trim().min(1).max(500)).max(40) }));
  const criteria = criteriaSchema.safeParse(row.criteria);
  return { company: String(row.company), domain: String(row.domain), roles: criteria.success ? criteria.data.buyerRoles : [] };
}

export async function readContacts(driver: QueryRunner, options: { database?: string }, params: { productId: string; matchId: string }) {
  const { records } = await driver.executeQuery(OutreachMatch + `
    MATCH (match)-[:MATCHES_COMPANY]->(company:AtlasCompany)
    CALL (match, version, company) {
      MATCH (target:AtlasBuyerRoleMatch)-[:IDENTIFIES]->(person:AtlasPerson)-[employment:WORKS_AT]->(company)
      WHERE target.productId = $productId AND target.profileId = version.profileId AND target.approvedAt = version.approvedAt
      MATCH (person)-[:EMPLOYMENT_EVIDENCE]->(source:AtlasEmploymentSource)-[:AT_COMPANY]->(company)
      WHERE source.role = employment.role AND source.url IS NOT NULL
      WITH DISTINCT person, employment, source ORDER BY source.retrievedAt DESC
      WITH person, employment, head(collect(source)) AS source
      RETURN person.id AS id, person.name AS name, employment.role AS role, source.url AS url,
        CASE WHEN source.url =~ '(?i)^https://([a-z0-9-]+[.])?linkedin[.]com/in/.*' THEN source.url ELSE null END AS profileUrl,
        source.excerpt AS excerpt, source.retrievedAt AS retrievedAt, false AS manual
      UNION
      MATCH (match)-[:HAS_OUTREACH_CONTACT]->(contact:AtlasOutreachContact)
      RETURN contact.id AS id, contact.name AS name, contact.role AS role, contact.url AS url,
             contact.profileUrl AS profileUrl, contact.excerpt AS excerpt, contact.retrievedAt AS retrievedAt,
             contact.excerpt IS NULL AS manual
    }
    RETURN id, name, role, url, profileUrl, manual, excerpt, retrievedAt, company.domain AS domain ORDER BY name
  `, params, options);
  return records.map((record) => {
    const row = record.toObject();
    return { ...OutreachContact.parse(row), domain: String(row.domain) };
  });
}

export async function readOutreachHistory(driver: QueryRunner, options: { database?: string }, productId: string) {
  const { records } = await driver.executeQuery(`
    MATCH (:AtlasProduct {id: $productId})-[:HAS_ICP_VERSION]->(:AtlasIcpVersion)
          -[:DISCOVERED_MATCH]->(match:AtlasAccountMatch)-[:MATCHES_COMPANY]->(company:AtlasCompany)
    MATCH (match)-[:HAS_OUTREACH_DRAFT]->(draft:AtlasOutreachDraft)-[:HAS_OUTREACH_EVENT]->(event:AtlasOutreachEvent)
    RETURN event.id AS id, event.kind AS kind, event.versionId AS versionId, event.at AS at,
           match.id AS matchId, coalesce(match.companyName, company.name) AS company,
           coalesce(draft.channel, "email") AS channel,
           coalesce(event.recipient, CASE WHEN (event.kind STARTS WITH "sandbox_" OR event.kind STARTS WITH "test_send_")
             THEN "Configured test inbox" ELSE coalesce(draft.recipient, match.companyName, company.name) END) AS recipient,
           (event.kind STARTS WITH "sandbox_" OR event.kind STARTS WITH "test_send_") AS demo
    ORDER BY at DESC, id
  `, { productId }, options);
  return records.map((record) => OutreachHistoryItem.parse(record.toObject()));
}

export type OutreachContactRecord = z.infer<typeof OutreachContact>;
