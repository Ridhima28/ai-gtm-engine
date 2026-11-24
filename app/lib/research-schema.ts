import { z } from "zod";
import { EvidenceSchema, PublicSourceUrl } from "./discovery-schema";

export const CompanyDomainSchema = z.string().trim().toLowerCase().max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
export const BuyerRequestSchema = z.object({
  company: z.string().trim().min(1).max(160),
  domain: CompanyDomainSchema,
  scope: z.object({ productId: z.uuid(), profileId: z.uuid(), approvedAt: z.iso.datetime() }).optional(),
  roles: z.array(z.string().trim().min(1).max(500)).min(1).max(40),
}).strict();
export const LinkedInProfile = PublicSourceUrl.refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com"))
    && /^\/in\/[^/]+\/?$/.test(url.pathname);
});
export const SourcedBuyer = EvidenceSchema.extend({
  name: z.string(),
  role: z.string(),
  targetRole: z.string(),
  profileUrl: LinkedInProfile.optional(),
});
export const BuyerResultSchema = z.object({
  people: z.array(SourcedBuyer).max(5),
  suggestedTitles: z.array(z.string()).max(5),
  graphWarning: z.string().optional(),
  warning: z.string().optional(),
});

export const CompetitionRequestSchema = z.object({
  productId: z.uuid(),
  productName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  capabilities: z.array(z.string().trim().max(500)).max(25).transform((items) => items.filter(Boolean)).default([]),
}).strict().refine(({ description, capabilities }) => Boolean(description || capabilities.length), {
  message: "Add a product description or a capability.",
  path: ["description"],
});
export type CompetitionRequest = z.infer<typeof CompetitionRequestSchema>;
export const CompetitorTypes = ["Direct", "Indirect", "Alternative"] as const;
export const CompetitorTypeSchema = z.enum(CompetitorTypes);
export const CompetitorClaimKind = z.enum(["Positioning", "Capabilities", "Pricing or packaging"]);
export const CompetitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: CompanyDomainSchema,
  category: CompetitorTypeSchema,
  classificationInference: z.string(),
  differenceInference: z.string().optional(),
  claims: z.array(EvidenceSchema.extend({ kind: CompetitorClaimKind, observation: z.string() })).min(1).max(6),
});
export const CompetitionResultSchema = z.object({
  productId: z.uuid(),
  competitors: z.array(CompetitorSchema).max(6),
  graphWarning: z.string().optional(),
  warning: z.string().optional(),
});
