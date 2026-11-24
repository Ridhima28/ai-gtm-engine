import { IndustryCorroborationSchema } from "./expansion-schema";
import { ReferenceSchema } from "./market-evidence";
import { ConfidenceReasonsSchema, ConfidenceSchema } from "./icp-confidence";
import { z } from "zod";

const ProductIntakeFieldSchema = z.enum([
  "name",
  "description",
  "capabilities",
  "technicalConstraints",
  "referenceWins",
  "pricingModel",
  "typicalContractValue",
]);

export const ProductIntakeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    capabilities: z.array(z.string().max(500)).max(25),
    technicalConstraints: z.array(z.string().max(500)).max(25),
    referenceWins: z.array(z.string().max(500)).max(25),
    pricingModel: z.string().max(500),
    typicalContractValue: z.string().max(500),
  })
  .strict();

export const IcpGenerationRequestSchema = z
  .object({ intake: ProductIntakeSchema })
  .strict();

const GeneratedFieldSchema = <Value extends z.ZodType>(value: Value) =>
  z
    .object({
      value,
      origin: z.enum(["Intake", "Hypothesis", "Not provided"]),
      evidenceRefs: z.array(ProductIntakeFieldSchema).max(7),
    })
    .strict();

const listField = GeneratedFieldSchema(
  z.array(z.string().max(500)).max(10),
);
const textField = GeneratedFieldSchema(z.string().max(500));

const GeneratedIcpProfileShape = z
  .object({
    industries: listField,
    classifications: z
      .object({
        naics: listField,
        sic: listField,
      })
      .strict(),
    headcountBand: textField,
    revenueBand: textField,
    buyerRoles: listField,
    buyerSeniority: listField,
    buyingTriggers: listField,
    exclusions: listField,
  })
  .strict();

// In the model response, an unavailable field has exactly one representation.
const reportedList = listField.extend({ value: z.array(z.string().trim().min(1).max(500)).min(1).max(10) });
const reportedOrigin = z.enum(["Intake", "Hypothesis"]);
const intakeOrigin = z.literal("Intake");
const factualList = reportedList.extend({ origin: intakeOrigin, evidenceRefs: listField.shape.evidenceRefs.min(1) }).nullable();
const factualText = textField.extend({
  value: z.string().trim().min(1).max(500),
  origin: intakeOrigin,
  evidenceRefs: textField.shape.evidenceRefs.min(1),
}).nullable();
const suggestedList = reportedList.extend({ origin: reportedOrigin }).nullable();

export const GeneratedIcpProfileFormatSchema = GeneratedIcpProfileShape.extend({
  industries: suggestedList,
  classifications: z.object({ naics: factualList, sic: factualList }).strict(),
  headcountBand: factualText,
  revenueBand: factualText,
  buyerRoles: suggestedList,
  buyerSeniority: suggestedList,
  buyingTriggers: suggestedList,
  exclusions: suggestedList,
});

export function normalizeGeneratedIcp(profile: z.infer<typeof GeneratedIcpProfileFormatSchema>) {
  const unavailable = <Value>(value: Value) => ({ value, origin: "Not provided" as const, evidenceRefs: [] });
  return {
    industries: profile.industries ?? unavailable([]),
    classifications: {
      naics: profile.classifications.naics ?? unavailable([]),
      sic: profile.classifications.sic ?? unavailable([]),
    },
    headcountBand: profile.headcountBand ?? unavailable(""),
    revenueBand: profile.revenueBand ?? unavailable(""),
    buyerRoles: profile.buyerRoles ?? unavailable([]),
    buyerSeniority: profile.buyerSeniority ?? unavailable([]),
    buyingTriggers: profile.buyingTriggers ?? unavailable([]),
    exclusions: profile.exclusions ?? unavailable([]),
  };
}

function isBlankValue(value: string | string[]) {
  return Array.isArray(value)
    ? value.length === 0
    : value.trim().length === 0;
}

export const GeneratedIcpProfileSchema =
  GeneratedIcpProfileShape.superRefine((profile, context) => {
    const fields = [
      ["industries", profile.industries],
      ["classifications.naics", profile.classifications.naics],
      ["classifications.sic", profile.classifications.sic],
      ["headcountBand", profile.headcountBand],
      ["revenueBand", profile.revenueBand],
      ["buyerRoles", profile.buyerRoles],
      ["buyerSeniority", profile.buyerSeniority],
      ["buyingTriggers", profile.buyingTriggers],
      ["exclusions", profile.exclusions],
    ] as const;

    fields.forEach(([path, field]) => {
      if (field.origin === "Intake" && field.evidenceRefs.length === 0) {
        context.addIssue({
          code: "custom",
          path: [...path.split("."), "evidenceRefs"],
          message: "Intake-derived values must cite an intake field.",
        });
      }
      if (field.origin === "Not provided" && !isBlankValue(field.value)) {
        context.addIssue({
          code: "custom",
          path: [...path.split("."), "value"],
          message: "Unavailable values must be left blank.",
        });
      }
    });

    for (const [path, field] of [
      ["classifications.naics", profile.classifications.naics],
      ["classifications.sic", profile.classifications.sic],
      ["headcountBand", profile.headcountBand],
      ["revenueBand", profile.revenueBand],
    ] as const) {
      const blank = isBlankValue(field.value);
      if (blank && field.origin !== "Not provided") {
        context.addIssue({
          code: "custom",
          path: path.split("."),
          message: "Unsupported factual values must be left blank.",
        });
      } else if (
        !blank &&
        (field.origin !== "Intake" || field.evidenceRefs.length === 0)
      ) {
        context.addIssue({
          code: "custom",
          path: path.split("."),
          message: "Factual values must be explicitly present in intake.",
        });
      }
    }
  });

export const IcpGenerationResponseSchema = z
  .object({
    profile: GeneratedIcpProfileSchema,
    confidence: ConfidenceSchema.optional(),
    confidenceReasons: ConfidenceReasonsSchema.optional(),
    references: z.array(ReferenceSchema).optional(),
    marketEvidence: z.array(IndustryCorroborationSchema).optional(),
    referenceStatus: z.enum(["checked", "unconfigured", "partial"]).optional(),
  })
  .strict();
