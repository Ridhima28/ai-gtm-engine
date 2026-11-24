import { randomUUID } from "node:crypto";
import { OutreachRequest, OutreachResponse, OutreachScope, OutreachOverview } from "@/app/lib/outreach-schema";
import { graphCredentialsAvailable, graphFailure, withGraph } from "@/app/lib/neo4j-graph";
import { enrichBusinessContact, outreachMailConfig, OutreachProblem, requestSendGrid, sendGridRejection } from "@/app/lib/outreach-providers";
import { OutreachMatch as Match, readContacts, readMatchTarget, readOutreachHistory } from "@/app/lib/outreach-graph";
import { stableId } from "@/app/lib/graph-identity";
import { z } from "zod";

type Scope = z.infer<typeof OutreachScope>;
type Input = z.infer<typeof OutreachRequest>;

const FindDraft = Match + `
  MATCH (match)-[:HAS_OUTREACH_DRAFT]->(draft:AtlasOutreachDraft)
  WHERE coalesce(draft.channel, "email") = $channel AND draft.id = $draftId
`;
const ReadDraft = FindDraft + `
  MATCH (draft)-[:HAS_DRAFT_VERSION]->(current:AtlasOutreachVersion {id: draft.currentVersionId})
  OPTIONAL MATCH (draft)-[:HAS_OUTREACH_EVENT]->(event:AtlasOutreachEvent)
  WITH match, draft, current, event ORDER BY event.at, event.id
  WITH match, draft, current, collect(event { .id, .kind, .versionId, .at, .recipient }) AS events
  RETURN {
    versionId: current.id, subject: current.subject, body: current.body,
    approvedVersionId: draft.approvedVersionId, busy: draft.operation IS NOT NULL,
    testAccepted: coalesce(current.testAccepted, false),
    testUnconfirmed: coalesce(current.testUnconfirmed, false),
    recipient: coalesce(draft.recipient, match.companyName, "Company team"), profileUrl: draft.profileUrl,
    sent: coalesce(current.sent, false), events: events
  } AS draft
`;

function draftScope(input: Scope) {
  const draftId = input.buyerId ? stableId("outreach-recipient", input.matchId, input.channel, input.buyerId)
    : input.channel === "email" ? input.matchId : stableId("linkedin-outreach", input.matchId);
  return { ...input, draftId };
}

function readDraft(input: Scope) {
  return withGraph(async (driver, options) => {
    const { records } = await driver.executeQuery(ReadDraft, draftScope(input), options);
    return OutreachResponse.parse({ draft: records[0]?.get("draft") ?? null });
  });
}

function event(kind: string, versionId: string, recipient?: string) {
  return { id: randomUUID(), versionId, kind, at: new Date().toISOString(), ...(recipient ? { recipient } : {}) };
}

const RecordEvent = `
  CREATE (event:AtlasOutreachEvent)
  SET event = $event
  CREATE (draft)-[:HAS_OUTREACH_EVENT]->(event)
`;

async function writeDraft(input: Extract<Input, { action: "draft" | "edit" }>) {
  const next = randomUUID();
  await withGraph(async (driver, options) => {
    if (input.action === "draft") {
      const { records } = await driver.executeQuery(Match + `
        MATCH (match)-[:MATCHES_COMPANY]->(company:AtlasCompany)
        MATCH (match)-[:SUPPORTED_BY]->(evidence:AtlasObservation)
        RETURN coalesce(match.companyName, company.name) AS company,
               version.productName AS product, evidence.excerpt AS excerpt, evidence.url AS url
        ORDER BY evidence.retrievedAt DESC LIMIT 1
      `, input, options);
      if (!records.length) throw new OutreachProblem("The saved account has no source evidence to draft from.", 404);
      const { company, product, excerpt, url } = records[0].toObject();
      const buyer = input.buyerId
        ? (await readContacts(driver, options, input)).find(({ id }) => id === input.buyerId)
        : undefined;
      if (input.buyerId && !buyer) throw new OutreachProblem("Select a sourced contact from this account.", 404);
      if (input.channel === "linkedin" && !buyer) throw new OutreachProblem("Select a named contact for LinkedIn.", 400);
      const recipient = buyer?.name ?? `${company} team`;
      const quote = String(excerpt).split(/\s+/);
      const snippet = quote.slice(0, 25).join(" ") + (quote.length > 25 ? "…" : "");
      const subject = `Sales follow-up at ${String(company).replace(/[\r\n]+/g, " ")}`.slice(0, 200);
      const body = input.channel === "linkedin"
        ? `Hi ${recipient}, I saw your team’s public update about “${snippet}” (${url}). I’m working on ${product} and would like to hear how your team handles follow-up today. Open to connecting?`
        : `Hi ${recipient},\n\nI came across this on your public page: “${snippet}”\n${url}\n\nI’m working on ${product} and wanted to ask how your team handles follow-up today. Would a short conversation be useful?\n\nThanks`;
      await driver.executeQuery("CREATE CONSTRAINT atlas_outreach_draft_id IF NOT EXISTS FOR (n:AtlasOutreachDraft) REQUIRE n.id IS UNIQUE", {}, options);
      await driver.executeQuery(Match + `
        MERGE (draft:AtlasOutreachDraft {id: $draftId})
        ON CREATE SET draft.channel = $channel, draft.recipient = $recipient, draft.profileUrl = $profileUrl
        MERGE (match)-[:HAS_OUTREACH_DRAFT]->(draft)
        SET draft.lock = coalesce(draft.lock, 0) + 1
        WITH draft WHERE draft.currentVersionId IS NULL
        CREATE (draft)-[:HAS_DRAFT_VERSION]->(current:AtlasOutreachVersion {id: $next, subject: $subject, body: $body})
        SET draft.currentVersionId = $next
      ` + RecordEvent, { ...draftScope(input), next, subject, body, recipient, profileUrl: buyer?.profileUrl ?? null,
        event: event("drafted", next) }, options);
      return;
    }
    const edited = await driver.executeQuery(FindDraft + `
      SET draft.lock = coalesce(draft.lock, 0) + 1
      WITH draft WHERE draft.currentVersionId = $versionId AND draft.operation IS NULL
      MATCH (draft)-[:HAS_DRAFT_VERSION]->(prior:AtlasOutreachVersion {id: $versionId})
      WITH draft, prior WHERE prior.subject <> $subject OR prior.body <> $body
      CREATE (draft)-[:HAS_DRAFT_VERSION]->(current:AtlasOutreachVersion {id: $next, subject: $subject, body: $body})
      SET draft.currentVersionId = $next
      REMOVE draft.approvedVersionId
    ` + RecordEvent + " RETURN current.id AS id", { ...draftScope(input), next, subject: input.subject, body: input.body, versionId: input.versionId, event: event("edited", next) }, options);
    if (!edited.records.length) throw new OutreachProblem("No change was saved. Reload the latest draft if it was changed elsewhere.", 409);
  });
}

async function approve(input: Scope & { versionId: string }) {
  await withGraph(async (driver, options) => {
    const result = await driver.executeQuery(FindDraft + `
      SET draft.lock = coalesce(draft.lock, 0) + 1
      WITH draft WHERE draft.currentVersionId = $versionId AND draft.operation IS NULL
      FOREACH (_ IN CASE WHEN draft.approvedVersionId = $versionId THEN [] ELSE [1] END |
        SET draft.approvedVersionId = $versionId
    ` + RecordEvent + ") RETURN draft.currentVersionId AS id", { ...draftScope(input), versionId: input.versionId, event: event("approved", input.versionId) }, options);
    if (!result.records.length) throw new OutreachProblem("Reload and approve the current draft version.", 409);
  });
}

async function deliver(input: Scope & { versionId: string }, sandbox: boolean) {
  if (input.channel !== "email") throw new OutreachProblem("SendGrid is available for email drafts only.", 400);
  const config = outreachMailConfig();
  const operation = randomUUID();
  await withGraph(async (driver, options) => {
    const params = { ...draftScope(input), versionId: input.versionId, operation, sandbox };
    const locked = await driver.executeQuery(FindDraft + `
      SET draft.lock = coalesce(draft.lock, 0) + 1
      WITH draft WHERE draft.currentVersionId = $versionId AND draft.approvedVersionId = $versionId
        AND draft.operation IS NULL
      MATCH (draft)-[:HAS_DRAFT_VERSION]->(current:AtlasOutreachVersion {id: $versionId})
      WHERE $sandbox OR (NOT coalesce(current.testAccepted, false) AND NOT coalesce(current.testUnconfirmed, false))
      SET draft.operation = $operation
      RETURN current { .subject, .body } AS content
    `, params, options);
    if (!locked.records.length) throw new OutreachProblem("Approve the current draft first. A test may already be pending or accepted for this version.", 409);

    const recordFailure = (kind: string, unconfirmed = false) => driver.executeQuery(FindDraft + `
      AND draft.operation = $operation
      MATCH (draft)-[:HAS_DRAFT_VERSION]->(current:AtlasOutreachVersion {id: $versionId})
      REMOVE draft.operation
      FOREACH (_ IN CASE WHEN $unconfirmed THEN [1] ELSE [] END | SET current.testUnconfirmed = true)
    ` + RecordEvent, { ...params, unconfirmed, event: event(kind, input.versionId, config.recipient) }, options);

    let result: Response;
    try {
      result = await requestSendGrid(config, locked.records[0].get("content"), sandbox);
    } catch {
      await recordFailure(sandbox ? "sandbox_failed" : "test_send_unconfirmed", !sandbox);
      throw new OutreachProblem(sandbox ? "SendGrid could not validate the draft. Try again." :
        "Test delivery could not be confirmed. Check the test inbox or SendGrid before retrying. The draft is preserved.", 502);
    }
    if (result.status !== (sandbox ? 200 : 202)) {
      await recordFailure(sandbox ? "sandbox_failed" : "test_send_failed");
      const guidance = await sendGridRejection(result);
      throw new OutreachProblem([
        `SendGrid ${sandbox ? "validation" : "test send"} failed (HTTP ${result.status}). The approved draft is preserved.`,
        guidance,
      ].filter(Boolean).join(" "), 502);
    }

    try {
      const recorded = await driver.executeQuery(FindDraft + `
        AND draft.operation = $operation
        MATCH (draft)-[:HAS_DRAFT_VERSION]->(current:AtlasOutreachVersion {id: $versionId})
        REMOVE draft.operation
        FOREACH (_ IN CASE WHEN $sandbox THEN [] ELSE [1] END | SET current.testAccepted = true)
      ` + RecordEvent + " RETURN current.id AS id", {
        ...params, event: event(sandbox ? "sandbox_validated" : "test_send_accepted", input.versionId, config.recipient),
      }, options);
      if (!recorded.records.length) throw new Error("Pending outreach operation was not found");
    } catch (error) {
      graphFailure("record_outreach_provider_result", error);
      throw new OutreachProblem(sandbox ? "SendGrid validated the request, but the event could not be recorded." :
        "SendGrid accepted the test email, but the event could not be recorded. Check the test inbox before retrying.", 502);
    }
  });
}

async function enrich(input: Extract<Input, { action: "enrich" }>) {
  const person = await withGraph(async (driver, options) =>
    (await readContacts(driver, options, input)).find(({ id }) => id === input.buyerId));
  if (!person?.domain) throw new OutreachProblem("Contact enrichment requires a named contact and company domain.", 404);
  return enrichBusinessContact(person.name, person.domain);
}

async function markLinkedInSent(input: Scope & { versionId: string }) {
  if (input.channel !== "linkedin") throw new OutreachProblem("Manual sending is available for LinkedIn only.", 400);
  const sent = event("linkedin_sent", input.versionId);
  await withGraph(async (driver, options) => {
    const result = await driver.executeQuery(FindDraft + `
      SET draft.lock = coalesce(draft.lock, 0) + 1
      WITH draft, match WHERE draft.currentVersionId = $versionId AND draft.approvedVersionId = $versionId
      MATCH (draft)-[:HAS_DRAFT_VERSION]->(current:AtlasOutreachVersion {id: $versionId})
      WHERE NOT coalesce(current.sent, false)
      SET current.sent = true, match.pipelineLock = coalesce(match.pipelineLock, 0) + 1
      FOREACH (_ IN CASE WHEN coalesce(match.pipelineStage, "Matched") = "Matched" THEN [1] ELSE [] END |
        SET match.pipelineStage = "Contacted"
        CREATE (match)-[:HAS_STAGE_EVENT]->(:AtlasPipelineEvent {id: $stageEventId, previous: "Matched",
          stage: "Contacted", actor: "Workspace user · LinkedIn marked sent", at: $event.at})
      )
    ` + RecordEvent + " RETURN current.id AS id", { ...draftScope(input), versionId: input.versionId, event: sent, stageEventId: randomUUID() }, options);
    if (!result.records.length) throw new OutreachProblem("Approve the current LinkedIn draft first, or reload its sent status.", 409);
  });
}

async function addContact(input: Extract<Input, { action: "add_contact" }>) {
  if (input.profileUrl && !/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\//i.test(input.profileUrl)) {
    throw new OutreachProblem("Use a public LinkedIn profile URL.", 400);
  }
  await withGraph(async (driver, options) => {
    await driver.executeQuery("CREATE CONSTRAINT atlas_outreach_contact_id IF NOT EXISTS FOR (n:AtlasOutreachContact) REQUIRE n.id IS UNIQUE", {}, options);
    const result = await driver.executeQuery(Match + `
      MERGE (contact:AtlasOutreachContact {id: $id})
      SET contact.name = $name, contact.role = $role, contact.url = $url, contact.profileUrl = $profileUrl
      MERGE (match)-[:HAS_OUTREACH_CONTACT]->(contact)
      RETURN contact.id AS id
    `, { ...input, profileUrl: input.profileUrl ?? null, id: stableId("outreach-contact", input.matchId, input.name.toLowerCase(), input.url) }, options);
    if (!result.records.length) throw new OutreachProblem("Select a saved account.", 404);
  });
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const productId = z.uuid().safeParse(query.get("productId"));
  const input = OutreachScope.safeParse({ productId: query.get("productId"), matchId: query.get("matchId"), channel: query.get("channel") ?? undefined, buyerId: query.get("buyerId") ?? undefined });
  if (!productId.success || (query.get("overview") !== "1" && !input.success)) {
    return Response.json({ error: "Select a saved account." }, { status: 400 });
  }
  if (!graphCredentialsAvailable()) return Response.json({ error: "Configure Neo4j to load outreach drafts." }, { status: 503 });
  try {
    if (query.get("overview") !== "1" && input.success) return Response.json(await readDraft(input.data));
    return Response.json(await withGraph(async (driver, options) => OutreachOverview.parse({
      events: await readOutreachHistory(driver, options, productId.data),
      contacts: input.success ? await readContacts(driver, options, input.data) : [],
      targetRoles: input.success ? (await readMatchTarget(driver, options, input.data))?.roles : [],
    })));
  } catch (error) {
    return Response.json({ error: graphFailure("read_outreach_draft", error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const parsed = OutreachRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Provide a valid outreach action and draft version." }, { status: 400 });
  if (!graphCredentialsAvailable()) return Response.json({ error: "Configure Neo4j to use outreach." }, { status: 503 });
  const input = parsed.data;
  const scope = OutreachScope.parse(input);
  try {
    if (input.action === "enrich") return Response.json(await enrich(input));
    if (input.action === "add_contact") {
      await addContact(input);
      return Response.json({ saved: true });
    }
    if (input.action === "draft" || input.action === "edit") await writeDraft(input);
    else if (input.action === "approve") await approve(input);
    else if (input.action === "mark_sent") await markLinkedInSent(input);
    else await deliver(input, input.action === "sandbox");
    return Response.json(await readDraft(scope));
  } catch (error) {
    if (error instanceof OutreachProblem) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: graphFailure("outreach_operation", error) }, { status: 502 });
  }
}
