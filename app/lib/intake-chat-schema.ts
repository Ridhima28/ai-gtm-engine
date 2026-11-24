import { z } from "zod";
import { ProductIntakeSchema } from "./icp-schema";

export const IntakeDraftSchema = ProductIntakeSchema.omit({ id: true }).extend({
  name: z.string().trim().max(120),
  description: z.string().trim().max(2000),
});

export const IntakePatchSchema = IntakeDraftSchema.partial();
export type IntakePatch = z.infer<typeof IntakePatchSchema>;

export const IntakeChatReplySchema = z.object({
  reply: z.string().trim().min(1).max(300),
  patch: IntakePatchSchema,
}).strict();
