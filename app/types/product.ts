import type { TargetingSchema } from "@/app/lib/discovery-schema";
import type { z } from "zod";
import type { Reference } from "@/app/lib/market-evidence";
import type { Hypothesis, IndustryCorroboration } from "@/app/lib/expansion-schema";

export interface ProductIntake {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  technicalConstraints: string[];
  referenceWins: string[];
  pricingModel: string;
  typicalContractValue: string;
}

export type ProductIntakeField = Exclude<keyof ProductIntake, "id">;

export type IcpConfidenceField =
  | "industries"
  | "classifications"
  | "naics"
  | "sic"
  | "headcountBand"
  | "revenueBand"
  | "buyerRoles"
  | "buyerSeniority"
  | "buyingTriggers"
  | "exclusions";

export type IcpProfileField =
  | "industries"
  | "naics"
  | "sic"
  | "headcountBand"
  | "revenueBand"
  | "buyerRoles"
  | "buyerSeniority"
  | "buyingTriggers"
  | "exclusions";

export type IcpFieldOrigin =
  | "Intake"
  | "Hypothesis"
  | "Not provided"
  | "Sample"
  | "Edited by you";

export interface IcpFieldMetadata {
  confidenceReason?: string;
  origin: IcpFieldOrigin;
  evidenceRefs?: ProductIntakeField[];
}

export interface GeneratedIcpField<Value> {
  value: Value;
  origin: Exclude<IcpFieldOrigin, "Sample" | "Edited by you">;
  evidenceRefs: ProductIntakeField[];
}

export interface GeneratedIcpProfile {
  industries: GeneratedIcpField<string[]>;
  classifications: {
    naics: GeneratedIcpField<string[]>;
    sic: GeneratedIcpField<string[]>;
  };
  headcountBand: GeneratedIcpField<string>;
  revenueBand: GeneratedIcpField<string>;
  buyerRoles: GeneratedIcpField<string[]>;
  buyerSeniority: GeneratedIcpField<string[]>;
  buyingTriggers: GeneratedIcpField<string[]>;
  exclusions: GeneratedIcpField<string[]>;
}

export interface IdealCustomerProfile {
  id: string;
  productId: string;
  industries: string[];
  classifications: {
    naics: string[];
    sic: string[];
  };
  headcountBand: string;
  revenueBand: string;
  buyerRoles: string[];
  buyerSeniority: string[];
  buyingTriggers: string[];
  exclusions: string[];
  confidence?: Partial<Record<IcpConfidenceField, number>>;
  fieldMetadata?: Partial<Record<IcpProfileField, IcpFieldMetadata>>;
  references?: Reference[];
  marketEvidence?: IndustryCorroboration[];
  referenceStatus?: "checked" | "unconfigured" | "partial";
  acceptedSegments?: Hypothesis[];
  targeting?: z.infer<typeof TargetingSchema>;
  generationSource?: "sample" | "live";
}
