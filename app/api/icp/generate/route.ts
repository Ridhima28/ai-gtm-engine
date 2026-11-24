import { openAiFailure } from "@/app/lib/openai-error";
import { corroborateIndustries } from "@/app/lib/openalex";
import { resolveReferences } from "@/app/lib/market-evidence";
import { scoreProfile } from "@/app/lib/icp-confidence";
import OpenAI from "openai";
import { ZodError } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import {
  GeneratedIcpProfileFormatSchema,
  GeneratedIcpProfileSchema,
  IcpGenerationRequestSchema,
  normalizeGeneratedIcp,
} from "@/app/lib/icp-schema";
import type {
  GeneratedIcpProfile,
  ProductIntake,
  ProductIntakeField,
} from "@/app/types/product";

function hasIntakeValue(intake: ProductIntake, field: ProductIntakeField) {
  const value = intake[field];
  return Array.isArray(value)
    ? value.some((item) => item.trim().length > 0)
    : typeof value === "string" && value.trim().length > 0;
}

function intakeText(intake: ProductIntake, field: ProductIntakeField) {
  const value = intake[field];
  return Array.isArray(value) ? value : [value];
}

function invalidEvidencePaths(profile: GeneratedIcpProfile, intake: ProductIntake) {
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

  return fields.flatMap(([path, field]) => {
    const issues: { path: string; code: string; reference?: ProductIntakeField }[] = field.evidenceRefs.flatMap((reference, index) =>
      hasIntakeValue(intake, reference) ? [] : [{ path: `${path}.evidenceRefs.${index}`, code: "empty_intake_reference", reference }],
    );
    if (issues.length) return issues;
    if (field.origin !== "Intake") return [];

    const sourceText = field.evidenceRefs
      .flatMap((reference) => intakeText(intake, reference))
      .map((value) => value.trim().toLowerCase());
    const values = Array.isArray(field.value) ? field.value : [field.value];
    return values.flatMap((value, index) => {
      const normalized = value.trim().toLowerCase();
      return !normalized || sourceText.some((source) => source.includes(normalized))
        ? []
        : [{ path: Array.isArray(field.value) ? `${path}.value.${index}` : `${path}.value`, code: "not_verbatim" }];
    });
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const requestResult = IcpGenerationRequestSchema.safeParse(body);
  if (!requestResult.success) {
    return Response.json(
      { error: "Product intake is invalid. Check the required fields and try again." },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    return Response.json(
      {
        error:
          "Live generation is not configured. Add OPENAI_API_KEY to .env.local, or use the sample option.",
      },
      { status: 503 },
    );
  }

  const { intake } = requestResult.data;
  const client = new OpenAI({ apiKey, timeout: 25000, maxRetries: 0 });

  try {
    const enrichmentConfigured = Boolean(process.env.CRUNCHBASE_API_KEY || process.env.EXPLORIUM_API_KEY);
    const enrichment = await resolveReferences(intake.referenceWins).catch(() => ({ references: [], partial: true }));
    const { references } = enrichment;
    const referenceStatus = !enrichmentConfigured ? "unconfigured" : enrichment.partial ? "partial" : "checked";
    const availableEvidence = Object.keys(intake).filter(
      (field): field is ProductIntakeField => field !== "id" && hasIntakeValue(intake, field as ProductIntakeField),
    );
    const response = await client.responses.parse({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: [
            "Create a structured ideal customer profile using the submitted intake and resolved reference context.",
            "Use resolved references as context for shaping hypotheses. Do not present vendor estimates as founder claims. Never add unsupported factual claims.",
            "Mark a value as Intake only when it is explicitly copied from the submitted intake, and cite the exact intake field name in evidenceRefs.",
            "Mark every inference as Hypothesis. Hypotheses must be framed as plausible targeting suggestions, not facts, and should cite relevant intake fields when useful.",
            "For buyerRoles, infer 2 or 3 concrete job titles or responsibility-based roles likely to own the stated workflow or approve the purchase. Mark inferred roles Hypothesis and cite relevant populated intake fields.",
            "For buyingTriggers, infer 2 or 3 observable events that would make the stated product useful now. Tie the events to the described pain or capabilities. A trigger is a change or incident, not a feature, benefit, or pricing model. Mark inferred triggers Hypothesis and cite relevant populated intake fields.",
            "When the intake names a team and describes its workflow or a problem, provide both buyerRoles and buyingTriggers even if the founder did not name exact titles or events. For example, for a recruiting team that automates interview scheduling, a Recruiting Operations Manager is a plausible buyer and a sudden increase in open roles is a plausible trigger.",
            "Return null for the entire field when information is unavailable and a grounded hypothesis is inappropriate. Never insert placeholder text or an empty value in a field object.",
            "NAICS and SIC codes are factual classifications: include them only when exact codes are present in the intake, otherwise return null.",
            "Headcount and revenue bands must be null unless the intake explicitly states them. Small teams and per-seat pricing do not supply either band.",
            `Only these populated intake fields may appear in evidenceRefs: ${availableEvidence.join(", ")}.`,
            "Return every required field. Do not include confidence scores.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({ intake, references }),
        },
      ],
      text: {
        format: zodTextFormat(
          GeneratedIcpProfileFormatSchema,
          "ideal_customer_profile",
        ),
      },
    });

    if (!response.output_parsed) {
      return Response.json(
        { error: "The model did not return a structured ICP. Your saved data is unchanged." },
        { status: 502 },
      );
    }

    const profileResult = GeneratedIcpProfileSchema.safeParse(normalizeGeneratedIcp(response.output_parsed));
    const validation = profileResult.success
      ? { stage: "intake_evidence", issues: invalidEvidencePaths(profileResult.data, intake) }
      : { stage: "profile_schema", issues: profileResult.error.issues.map(({ path, code, message }) => ({ path: path.join("."), code, rule: code === "custom" ? message : undefined })) };
    if (!profileResult.success || validation.issues.length) {
      console.warn("ICP validation failed", JSON.stringify(validation));
      return Response.json(
        {
          error:
            "The generated ICP did not pass validation. Your saved data is unchanged.",
        },
        { status: 502 },
      );
    }

    const marketEvidence = await corroborateIndustries(profileResult.data.industries.value, intake.capabilities);
    return Response.json({
      profile: profileResult.data,
      marketEvidence,
      ...scoreProfile(profileResult.data, references, marketEvidence.map(({ industry }) => industry)),
      references,
      referenceStatus,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      console.warn("ICP validation failed", JSON.stringify({
        stage: "structured_output",
        issues: error.issues.map(({ path, code }) => ({ path: path.join("."), code })),
      }));
      return Response.json(
        { error: "The generated ICP did not match the response schema. Your saved data is unchanged." },
        { status: 502 },
      );
    }
    console.error("ICP generation failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      requestId: error instanceof OpenAI.APIError ? error.requestID : undefined,
    });
    const failure = openAiFailure(error, "ICP generation failed. Try again.");
    return Response.json({ error: `${failure.message} Sample generation is still available.` }, { status: failure.status });
  }
}
