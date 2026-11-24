import { z } from "zod";
import { DiscoveryCriteriaSchema, EvidenceSchema, IcpCategorySchema } from "./discovery-schema";
import { CompanyDomainSchema } from "./research-schema";

export const ApprovedDiscoveryVersion = DiscoveryCriteriaSchema.extend({ productId: z.uuid(), profileId: z.uuid() });

export const GraphAccountEvidence = EvidenceSchema.extend({
  company: z.string().min(1).max(160),
  domain: CompanyDomainSchema,
  observation: z.string().min(1).max(500),
  inference: z.string().min(1).max(500),
  category: IcpCategorySchema,
});

export const GraphMatch = z.object({
  id: z.string(),
  company: z.string(),
  domain: CompanyDomainSchema,
  approvedAt: z.iso.datetime(),
  profileId: z.uuid(),
  versionId: z.string(),
  productName: z.string(),
  inference: z.string(),
  buyers: z.array(EvidenceSchema.extend({ id: z.string(), name: z.string(), role: z.string() })).default([]),
  checks: z.array(z.object({ url: EvidenceSchema.shape.url, checkedAt: z.iso.datetime(), status: z.enum(["unchanged", "updated", "unavailable", "unconfirmed"]) })).default([]),
  evidence: z.array(EvidenceSchema.extend({
    id: z.string(),
    observation: z.string(),
    category: IcpCategorySchema,
  })),
});

export const GraphResponse = z.object({
  matches: z.array(GraphMatch),
  segments: z.array(z.object({
    segment: z.string(), painPoint: z.string(), capability: z.string(),
    naics: z.string(), rationale: z.string(), sources: z.array(z.string()),
  })),
});
