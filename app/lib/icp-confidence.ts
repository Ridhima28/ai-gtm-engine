import { z } from "zod";
import type { GeneratedIcpField, GeneratedIcpProfile } from "@/app/types/product";
import type { Reference } from "./market-evidence";

export const ConfidenceSchema = z.record(z.string(), z.number().min(0).max(1));

export const ConfidenceReasonsSchema = z.record(z.string(), z.string());

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function scoreProfile(profile: GeneratedIcpProfile, references: Reference[], corroboratedIndustries: string[] = []) {
  function score(field: GeneratedIcpField<string | string[]>, readValues: (reference: Reference) => string[] = () => [], corroboration: string[] = []) {
    const values = (Array.isArray(field.value) ? field.value : [field.value]).map(normalize).filter(Boolean);
    if (!values.length || field.origin === "Not provided") return undefined;

    const explicit = field.origin === "Intake";
    const distinctMatches = new Set(references.filter((reference) => {
      const supplied = new Set(readValues(reference).map(normalize));
      return values.every((value) => supplied.has(value));
    }).map(({ domain }) => domain)).size;
    const founderEvidence = explicit ? 1 : field.evidenceRefs.length ? 0.7 : 0.2;
    const referenceEvidence = Math.min(distinctMatches / 2, 1);
    const marketValues = new Set(corroboration.map(normalize));
    const marketEvidence = values.every((value) => marketValues.has(value)) ? 1 : 0;
    const weighted = 0.50 * founderEvidence + 0.35 * referenceEvidence + 0.15 * marketEvidence;
    const value = Math.min(Math.round(weighted * 100) / 100, explicit && distinctMatches >= 2 ? 1 : 0.84);
    const origin = explicit ? "Explicit intake" : field.evidenceRefs.length ? "Intake-linked hypothesis" : "Unconfirmed hypothesis";
    const customers = distinctMatches === 1 ? "1 matching reference" : `${distinctMatches} matching references`;
    return { value, reason: `${origin} · ${customers} · ${marketEvidence ? "market evidence found" : "no market corroboration"}` };
  }

  const fields = {
    industries: score(profile.industries, (reference) => reference.industries, corroboratedIndustries),
    naics: score(profile.classifications.naics),
    sic: score(profile.classifications.sic, (reference) => [reference.sic ?? ""]),
    headcountBand: score(profile.headcountBand, (reference) => [reference.headcountBand ?? ""]),
    revenueBand: score(profile.revenueBand, (reference) => [reference.revenueBand ?? ""]),
    buyerRoles: score(profile.buyerRoles),
    buyerSeniority: score(profile.buyerSeniority),
    buyingTriggers: score(profile.buyingTriggers),
    exclusions: score(profile.exclusions),
  };
  const scored = Object.entries(fields).flatMap(([field, result]) => result ? [[field, result] as const] : []);
  return {
    confidence: Object.fromEntries(scored.map(([field, result]) => [field, result.value])),
    confidenceReasons: Object.fromEntries(scored.map(([field, result]) => [field, result.reason])),
  };
}
