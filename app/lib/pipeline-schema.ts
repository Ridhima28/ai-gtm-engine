import { z } from "zod";
import { OutreachHistoryItem } from "./outreach-schema";

export const PipelineStages = ["Matched", "Contacted", "Replied", "Meeting Booked", "Closed", "Lost"] as const;
export const PipelineStage = z.enum(PipelineStages);
export const StageChange = z.object({
  productId: z.uuid(),
  matchId: z.string().regex(/^[a-f0-9]{64}$/),
  previous: PipelineStage,
  stage: PipelineStage,
  actor: z.string().trim().min(1).max(100),
}).strict();
export const StageEvent = z.object({
  id: z.uuid(), previous: PipelineStage, stage: PipelineStage, actor: z.string(), at: z.iso.datetime(),
});
export const PipelineResponse = z.object({
  leads: z.array(z.object({
    id: StageChange.shape.matchId, stage: PipelineStage, changes: z.array(StageEvent),
  })),
  outreach: z.array(OutreachHistoryItem),
});
