import { z } from "zod";

export const ResearchWorkSchema = z.object({
  id: z.string().regex(/^https:\/\/(?:openalex\.org\/W\d+|doi\.org\/10\.\d{4,}\/[^\s?#]+)$/),
  title: z.string(),
  year: z.number().nullable(),
});
export const IndustryCorroborationSchema = ResearchWorkSchema.extend({ industry: z.string() });
export type IndustryCorroboration = z.infer<typeof IndustryCorroborationSchema>;

export const HypothesisSchema = z.object({
  segment: z.string().min(1).max(180),
  capability: z.string().min(1).max(500),
  painPoint: z.string().min(1).max(250),
  naics: z.string().regex(/^\d{6}$/),
  rationale: z.string().min(1).max(600),
  targetHeadcount: z.string().trim().max(100).optional(),
  evidence: z.array(ResearchWorkSchema.extend({ excerpt: z.string().trim().min(1).max(300).optional() })).min(1).max(3),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const AdjacentCandidate = HypothesisSchema.pick({ segment: true, painPoint: true, capability: true }).extend({
  industryKeyword: z.string().trim().min(1).max(80),
  processKeyword: z.string().trim().min(1).max(100),
});
export const AdjacentIdea = z.object({
  candidate: AdjacentCandidate,
  missing: z.string().min(1).max(400),
  context: HypothesisSchema.shape.evidence.element.optional(),
});
export const ExpansionResults = z.object({
  hypotheses: z.array(HypothesisSchema),
  ideas: z.array(AdjacentIdea).default([]),
  warning: z.string().optional(),
});
