import { z } from "zod";
import { SourcedBuyer } from "./research-schema";
import { PublicSourceUrl } from "./discovery-schema";

export const OutreachChannel = z.enum(["email", "linkedin"]);
const ContactId = z.string().regex(/^[a-f0-9]{64}$/);

export const OutreachScope = z.object({
  productId: z.uuid(),
  matchId: ContactId,
  channel: OutreachChannel.default("email"),
  buyerId: ContactId.optional(),
});
const Subject = z.string().min(1).max(200).regex(/^[^\r\n]+$/).refine((value) => Boolean(value.trim()));
const Body = z.string().min(1).max(12000).refine((value) => Boolean(value.trim()));
const Version = z.uuid();
const Action = z.enum(["approve", "sandbox", "test_send", "mark_sent"]);
export const OutreachRequest = z.union([
  OutreachScope.extend({ action: z.literal("draft") }).strict(),
  OutreachScope.extend({ action: z.literal("edit"), versionId: Version, subject: Subject, body: Body }).strict(),
  OutreachScope.extend({ action: Action, versionId: Version }).strict(),
  OutreachScope.extend({ action: z.literal("enrich"), buyerId: ContactId }).strict(),
  OutreachScope.extend({ action: z.literal("add_contact"), name: z.string().trim().min(1).max(160),
    role: z.string().trim().min(1).max(160), url: PublicSourceUrl, profileUrl: PublicSourceUrl.optional() }).strict(),
]);
export const OutreachContact = z.object({
  id: ContactId, name: z.string(), role: z.string(), url: PublicSourceUrl,
  profileUrl: PublicSourceUrl.nullable().optional(), manual: z.boolean().optional(),
  excerpt: z.string().nullable().optional(), retrievedAt: z.iso.datetime().nullable().optional(),
});
export const OutreachEvent = z.object({
  id: z.uuid(),
  versionId: Version,
  kind: z.enum(["drafted", "edited", "approved", "sandbox_validated", "sandbox_failed",
    "test_send_accepted", "test_send_failed", "test_send_unconfirmed", "linkedin_sent"]),
  recipient: z.string().nullable().optional(),
  at: z.iso.datetime(),
});
export const OutreachDraft = z.object({
  versionId: Version,
  approvedVersionId: Version.nullable(),
  subject: Subject,
  body: Body,
  busy: z.boolean(),
  testAccepted: z.boolean(),
  testUnconfirmed: z.boolean(),
  events: z.array(OutreachEvent),
  recipient: z.string(),
  profileUrl: PublicSourceUrl.nullable(),
  sent: z.boolean(),
});
export const OutreachResponse = z.object({ draft: OutreachDraft.nullable() });
export const ContactResult = z.object({
  email: z.email().nullable(),
  status: z.enum(["valid", "accept_all", "unknown", "not_found"]),
});

export const OutreachHistoryItem = OutreachEvent.extend({
  matchId: ContactId, company: z.string(), channel: OutreachChannel, recipient: z.string(),
  demo: z.boolean(),
});
export const OutreachOverview = z.object({
  events: z.array(OutreachHistoryItem),
  contacts: z.array(OutreachContact),
  targetRoles: z.array(z.string()).default([]),
});

export const ProspectScope = OutreachScope.pick({ productId: true, matchId: true });
export const ProspectRequest = z.discriminatedUnion("action", [
  ProspectScope.extend({ action: z.literal("search") }).strict(),
  ProspectScope.extend({ action: z.literal("save"), proof: z.string().max(12000) }).strict(),
]);
export const ProspectsResponse = z.object({
  people: z.array(SourcedBuyer.extend({ proof: z.string() })).max(5),
  suggestedTitles: z.array(z.string()).max(5),
  warning: z.string().optional(),
});
