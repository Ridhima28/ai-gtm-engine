import { discoverLinkedInProspects } from "@/app/lib/buyer-discovery";
import { issueProspectProof, readProspectProof } from "@/app/lib/graph-proof";
import { stableId } from "@/app/lib/graph-identity";
import { graphCredentialsAvailable, graphFailure, withGraph } from "@/app/lib/neo4j-graph";
import { openAiFailure } from "@/app/lib/openai-error";
import { OutreachMatch, readMatchTarget } from "@/app/lib/outreach-graph";
import { OutreachContact, ProspectRequest, ProspectsResponse } from "@/app/lib/outreach-schema";

import { researchTrace } from "@/app/lib/research-trace";

export async function POST(request: Request) {
  const trace = researchTrace(request);
  const parsed = ProspectRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Select a saved account and a valid prospect action." }, { status: 400 });
  if (!graphCredentialsAvailable()) return Response.json({ error: "Aura is needed to open the saved account." }, { status: 503 });
  const input = parsed.data;
  if (input.action === "save") {
    const proof = readProspectProof(input.proof);
    if (!proof || proof.matchId !== input.matchId || proof.productId !== input.productId) {
      return Response.json({ error: "Run prospect discovery again to save this candidate." }, { status: 400 });
    }
    const person = proof.person;
    const contact = { ...person, profileUrl: person.profileUrl ?? null, manual: false,
      id: stableId("outreach-prospect", input.matchId, person.name.normalize("NFKC").toLowerCase()) };
    try {
      const saved = await withGraph(async (driver, options) => {
        await driver.executeQuery("CREATE CONSTRAINT atlas_outreach_contact_id IF NOT EXISTS FOR (n:AtlasOutreachContact) REQUIRE n.id IS UNIQUE", {}, options);
        const { records } = await driver.executeQuery(OutreachMatch + `
          MERGE (person:AtlasOutreachContact {id: $contact.id})
          SET person.name = $contact.name, person.role = $contact.role, person.url = $contact.url,
              person.excerpt = $contact.excerpt, person.retrievedAt = $contact.retrievedAt, person.profileUrl = $contact.profileUrl
          MERGE (match)-[:HAS_OUTREACH_CONTACT]->(person)
          RETURN person.id AS id
        `, { productId: input.productId, matchId: input.matchId, contact }, options);
        return records.length > 0;
      });
      return saved ? Response.json(OutreachContact.parse(contact)) :
        Response.json({ error: "This company match is no longer available." }, { status: 404 });
    } catch (error) {
      return Response.json({ error: graphFailure("save_outreach_prospect", error) }, { status: 502 });
    }
  }

  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key || !process.env.OPENAI_API_KEY) return Response.json({ error: "Buyer research is unavailable on this server." }, { status: 503 });
  try {
    const target = await withGraph((driver, options) => readMatchTarget(driver, options, input));
    if (!target) return Response.json({ error: "This company match is no longer available." }, { status: 404 });
    if (!target.roles.length) return Response.json({ error: "The approved ICP used for this account has no buyer roles." }, { status: 409 });
    const result = await discoverLinkedInProspects(target, key, trace);
    return trace.respond(ProspectsResponse.parse({
      ...result,
      people: result.people.map((person) => ({ ...person, proof: issueProspectProof({ ...input, person }) })),
    }));
  } catch (error) {
    const failure = openAiFailure(error, "LinkedIn prospect discovery could not complete. Try again.");
    return trace.respond({ error: failure.message }, failure.status);
  }
}
