import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { BandConfirmation } from "./band-review-schema";
import { ProspectScope } from "./outreach-schema";
import { SourcedBuyer } from "./research-schema";
import { ApprovedDiscoveryVersion, GraphAccountEvidence } from "./graph-schema";

const SaveProof = z.object({ version: ApprovedDiscoveryVersion, account: GraphAccountEvidence });

const ProspectProof = ProspectScope.extend({ person: SourcedBuyer });

function signature(payload: string, key: string, namespace: string) {
  return createHmac("sha256", key).update(`atlas:${namespace}:v1:`).update(payload).digest();
}

function issueProof(schema: z.ZodType, namespace: string, value: unknown) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return undefined;
  const proof = schema.safeParse(value);
  if (!proof.success) return undefined;
  const payload = Buffer.from(JSON.stringify(proof.data)).toString("base64url");
  return `${payload}.${signature(payload, key, namespace).toString("base64url")}`;
}

function readProof<T>(schema: z.ZodType<T>, namespace: string, token: string) {
  const key = process.env.OPENAI_API_KEY;
  const [payload, mac, extra] = token.split(".");
  if (!key || !payload || !mac || extra !== undefined) return undefined;
  const expected = signature(payload, key, namespace);
  const received = Buffer.from(mac, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return undefined;
  }
}

export function issueGraphProof(value: z.input<typeof SaveProof>) { return issueProof(SaveProof, "graph:discovery", value); }
export function readGraphProof(token: string) { return readProof(SaveProof, "graph:discovery", token); }
export function issueProspectProof(value: z.input<typeof ProspectProof>) { return issueProof(ProspectProof, "outreach:prospect", value); }
export function readProspectProof(token: string) { return readProof(ProspectProof, "outreach:prospect", token); }

export function issueBandConfirmation(value: z.input<typeof BandConfirmation>) { return issueProof(BandConfirmation, "band:account-review", value); }
export function readBandConfirmation(token: string) { return readProof(BandConfirmation, "band:account-review", token); }
