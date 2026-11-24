import { z } from "zod";

export const IcpCategories = ["Firmographics", "Technographics", "Pain Points & Triggers", "Budget & Decision-Making"] as const;
export const IcpCategorySchema = z.enum(IcpCategories);

const Terms = z.array(z.string().trim().min(1).max(500)).max(40);
export const TargetingSchema = z.object({
  technology: Terms,
  painPoints: Terms,
  budget: Terms,
  decisionProcess: Terms,
});

export const DiscoveryCriteriaSchema = z.object({
  productId: z.uuid().optional(),
  profileId: z.uuid().optional(),
  productName: z.string().trim().min(1).max(120),
  approvedAt: z.iso.datetime(),
  industries: Terms,
  buyerRoles: Terms,
  buyingTriggers: Terms,
  exclusions: Terms,
  targeting: TargetingSchema.optional(),
}).strict();

export const DiscoveryRequestSchema = DiscoveryCriteriaSchema.refine(({ industries, buyerRoles, buyingTriggers }) =>
  industries.length + buyerRoles.length + buyingTriggers.length > 0,
  "Provide at least one targeting criterion.",
);

export type DiscoveryRequest = z.input<typeof DiscoveryRequestSchema>;

export const PublicSourceUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password;
});
export const EvidenceSchema = z.object({
  excerpt: z.string().min(1).max(420),
  url: PublicSourceUrl,
  retrievedAt: z.iso.datetime(),
});
export const DiscoveryResultSchema = z.object({
  warning: z.string().optional(),
  accounts: z.array(EvidenceSchema.extend({
    company: z.string(),
    observation: z.string(),
    inference: z.string(),
    domain: z.string().optional(),
    graphToken: z.string().optional(),
    observations: z.array(EvidenceSchema.extend({
      category: IcpCategorySchema,
      observation: z.string(),
    })).optional(),
  })).max(5),
  exclusions: z.array(EvidenceSchema.extend({
    company: z.string(),
    criterion: z.string(),
    observation: z.string(),
  })),
});
