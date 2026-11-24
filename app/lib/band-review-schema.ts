import { z } from "zod";
import { EvidenceSchema } from "./discovery-schema";

const GraphId = z.string().regex(/^[a-f0-9]{64}$/);
const Token = z.string().min(1).max(16000);
export const BandReviewSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), productId: z.uuid(), matchId: GraphId, observationId: GraphId }).strict(),
  z.object({ kind: z.literal("fresh"), graphToken: z.string().min(1).max(250000) }).strict(),
]);
export const BandReviewRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), source: BandReviewSource }).strict(),
  z.object({ action: z.literal("send"), confirmed: z.literal(true), token: Token }).strict(),
]);
export const BandReviewEvidence = EvidenceSchema.extend({
  company: z.string().min(1).max(160), product: z.string().min(1).max(120),
  observation: z.string().min(1).max(500), inference: z.string().min(1).max(500),
});
export const BandDestination = z.object({
  roomId: z.uuid(), title: z.string().min(1).max(300),
  reviewer: z.object({ id: z.uuid(), handle: z.string().min(1).max(200), name: z.string().min(1).max(200) }),
});
export const BandConfirmation = z.object({
  evidence: BandReviewEvidence, destination: BandDestination, expiresAt: z.number().int(),
});
export const BandReviewPreview = z.object({
  evidence: BandReviewEvidence, roomId: z.uuid().nullable(), roomTitle: z.string().nullable(),
  reviewerHandle: z.string().nullable(), setupMessage: z.string().nullable(), token: Token.nullable(),
});
export const BandReviewReceipt = z.object({ messageId: z.string().min(1) });
export type BandReviewSource = z.infer<typeof BandReviewSource>;

export function bandReviewQuestions(company: string) {
  return [
    "Does the exact excerpt support the sourced observation?",
    `Does the exact excerpt support treating ${company} as a prospective buyer for this product?`,
  ];
}
