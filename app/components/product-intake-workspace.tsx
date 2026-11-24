"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { KnowledgeGraph } from "./knowledge-graph";
import { OutreachWorkspace } from "./outreach-workspace";
import { PipelineWorkspace } from "./pipeline-workspace";
import { ProductHistory } from "./product-history";
import { CompetitiveLandscape } from "./competitive-landscape";
import { AccountDiscovery } from "./account-discovery";
import { DiscoveryRequestSchema } from "@/app/lib/discovery-schema";
import { IntakeChat } from "./intake-chat";
import type { IntakePatch } from "@/app/lib/intake-chat-schema";
import { IcpExpansion } from "./icp-expansion";
import { DemoPageHeader, demoPageClass } from "./demo-page";
import { controlClass, primaryClass } from "./workspace-styles";
import { HypothesisSchema, IndustryCorroborationSchema, type Hypothesis } from "@/app/lib/expansion-schema";
import { ReferenceSchema } from "@/app/lib/market-evidence";
import { IcpGenerationResponseSchema } from "@/app/lib/icp-schema";
import type {
  GeneratedIcpField,
  IcpConfidenceField,
  IcpFieldMetadata,
  IcpProfileField,
  IdealCustomerProfile,
  ProductIntake,
  ProductIntakeField,
} from "@/app/types/product";

const STORAGE_KEY = "atlas-gtm-product-workspace";
const HISTORY_KEY = "atlas-gtm-product-history";
const workspaceViews = [
  ["intake", "Product intake / ICP"], ["discovery", "Account discovery"],
  ["competition", "Competitive landscape"], ["graph", "Knowledge graph"],
  ["outreach", "Outreach"], ["pipeline", "Pipeline"], ["history", "Product history"],
] as const;
type WorkspaceView = typeof workspaceViews[number][0];

interface SavedWorkspace {
  version: 1;
  product: ProductIntake;
  profile: IdealCustomerProfile | null;
  sourceIntake?: ProductIntake | null;
  approvedAt: string | null;
  needsReapproval: boolean;
  previouslyApproved?: boolean;
}

type SavedHistory = { id: string; savedAt: string; draft: SavedWorkspace };

function readHistory(): SavedHistory[] {
  const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  if (!Array.isArray(value)) throw new Error("Saved product history could not be read.");
  return value.filter((item): item is SavedHistory =>
    item && typeof item.id === "string" && typeof item.savedAt === "string" && isSavedWorkspace(item.draft));
}

function archiveWorkspace(draft: SavedWorkspace): SavedHistory[] {
  const history = readHistory();
  if (!hasDraftWork(draft.product, draft.profile)) return history;
  const id = [draft.product.id, draft.profile?.id ?? "intake", draft.approvedAt ?? "draft"].join(":");
  if (JSON.stringify(history.find((entry) => entry.id === id)?.draft) === JSON.stringify(draft)) return history;
  const entries = [{ id, savedAt: new Date().toISOString(), draft }, ...history.filter((entry) => entry.id !== id)];
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  return entries;
}

const emptyProduct = (): ProductIntake => ({
  id: "",
  name: "",
  description: "",
  capabilities: [],
  technicalConstraints: [],
  referenceWins: [],
  pricingModel: "",
  typicalContractValue: "",
});

function intakeValues({
  id, name, description, capabilities, technicalConstraints, referenceWins,
  pricingModel, typicalContractValue,
}: ProductIntake): ProductIntake {
  return { id, name, description, capabilities, technicalConstraints, referenceWins, pricingModel, typicalContractValue };
}

function hasDraftWork(product: ProductIntake, profile: IdealCustomerProfile | null) {
  return Boolean(profile) || Object.entries(product).some(([field, value]) =>
    field !== "id" && value.length > 0,
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProductIntake(value: unknown): value is ProductIntake {
  if (!value || typeof value !== "object") return false;
  const product = value as Record<string, unknown>;
  return (
    typeof product.id === "string" &&
    typeof product.name === "string" &&
    typeof product.description === "string" &&
    isStringArray(product.capabilities) &&
    isStringArray(product.technicalConstraints) &&
    isStringArray(product.referenceWins) &&
    typeof product.pricingModel === "string" &&
    typeof product.typicalContractValue === "string"
  );
}

function isFieldMetadata(value: unknown): value is IcpFieldMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  return (
    ["Intake", "Hypothesis", "Not provided", "Sample", "Edited by you"].includes(
      metadata.origin as string,
    ) &&
    (metadata.evidenceRefs === undefined ||
      (Array.isArray(metadata.evidenceRefs) &&
        metadata.evidenceRefs.every((field) =>
          [
            "name",
            "description",
            "capabilities",
            "technicalConstraints",
            "referenceWins",
            "pricingModel",
            "typicalContractValue",
          ].includes(field as string),
        )))
  );
}

function isIdealCustomerProfile(value: unknown): value is IdealCustomerProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  const classifications = profile.classifications as Record<string, unknown> | null;
  const confidence = profile.confidence;
  const fieldMetadata = profile.fieldMetadata;
  return (
    typeof profile.id === "string" &&
    typeof profile.productId === "string" &&
    isStringArray(profile.industries) &&
    isStringArray(profile.buyerRoles) &&
    isStringArray(profile.buyerSeniority) &&
    isStringArray(profile.buyingTriggers) &&
    isStringArray(profile.exclusions) &&
    typeof profile.headcountBand === "string" &&
    typeof profile.revenueBand === "string" &&
    !!classifications &&
    typeof classifications === "object" &&
    isStringArray(classifications.naics) &&
    isStringArray(classifications.sic) &&
    (profile.targeting === undefined || (profile.targeting !== null && typeof profile.targeting === "object" &&
      !Array.isArray(profile.targeting) && ["technology", "painPoints", "budget", "decisionProcess"].every((key) =>
        isStringArray((profile.targeting as Record<string, unknown>)[key])))) &&
    (profile.marketEvidence === undefined || IndustryCorroborationSchema.array().safeParse(profile.marketEvidence).success) &&
    (profile.references === undefined || ReferenceSchema.array().safeParse(profile.references).success) &&
    (profile.acceptedSegments === undefined || HypothesisSchema.array().safeParse(profile.acceptedSegments).success) &&
    (confidence === undefined ||
      (!!confidence && typeof confidence === "object" && !Array.isArray(confidence))) &&
    (fieldMetadata === undefined ||
      (!!fieldMetadata &&
        typeof fieldMetadata === "object" &&
        !Array.isArray(fieldMetadata) &&
        Object.values(fieldMetadata).every(isFieldMetadata))) &&
    (profile.generationSource === undefined ||
      profile.generationSource === "sample" ||
      profile.generationSource === "live")
  );
}

function isSavedWorkspace(value: unknown): value is SavedWorkspace {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    isProductIntake(record.product) &&
    (record.profile === null || isIdealCustomerProfile(record.profile)) &&
    (record.sourceIntake === undefined ||
      record.sourceIntake === null ||
      isProductIntake(record.sourceIntake)) &&
    (record.approvedAt === null || typeof record.approvedAt === "string") &&
    typeof record.needsReapproval === "boolean" &&
    (record.previouslyApproved === undefined ||
      typeof record.previouslyApproved === "boolean")
  );
}

function createSampleProfile(
  productId: string,
  existingId?: string,
): IdealCustomerProfile {
  return {
    id: existingId ?? crypto.randomUUID(),
    productId,
    industries: [
      "Business and professional services",
      "Manufacturing",
      "Financial services",
    ],
    classifications: { naics: [], sic: [] },
    headcountBand: "50–1,000 employees",
    revenueBand: "$10M–$500M annual revenue",
    buyerRoles: ["Operations leader", "Functional team lead", "Executive sponsor"],
    buyerSeniority: ["Director", "VP", "C-suite"],
    buyingTriggers: [
      "A team is outgrowing its current process",
      "A new initiative has an approved budget",
      "Leadership is consolidating tools or vendors",
    ],
    exclusions: [
      "Organizations without a clear owner for this problem",
      "Teams that require unsupported systems or integrations",
    ],
    generationSource: "sample",
    fieldMetadata: {
      industries: { origin: "Sample" },
      naics: { origin: "Sample" },
      sic: { origin: "Sample" },
      headcountBand: { origin: "Sample" },
      revenueBand: { origin: "Sample" },
      buyerRoles: { origin: "Sample" },
      buyerSeniority: { origin: "Sample" },
      buyingTriggers: { origin: "Sample" },
      exclusions: { origin: "Sample" },
    },
    confidence: {
      industries: 0.72,
      classifications: 0.4,
      headcountBand: 0.68,
      revenueBand: 0.56,
      buyerRoles: 0.74,
      buyerSeniority: 0.71,
      buyingTriggers: 0.62,
      exclusions: 0.53,
    },
  };
}

const profileFieldByKey: Partial<
  Record<keyof IdealCustomerProfile, IcpProfileField>
> = {
  industries: "industries",
  headcountBand: "headcountBand",
  revenueBand: "revenueBand",
  buyerRoles: "buyerRoles",
  buyerSeniority: "buyerSeniority",
  buyingTriggers: "buyingTriggers",
  exclusions: "exclusions",
};

const confidenceFieldByProfileField: Record<
  IcpProfileField,
  IcpConfidenceField
> = {
  industries: "industries",
  naics: "naics",
  sic: "sic",
  headcountBand: "headcountBand",
  revenueBand: "revenueBand",
  buyerRoles: "buyerRoles",
  buyerSeniority: "buyerSeniority",
  buyingTriggers: "buyingTriggers",
  exclusions: "exclusions",
};

const intakeFieldLabels: Record<ProductIntakeField, string> = {
  name: "Product name",
  description: "Plain-language description",
  capabilities: "Capabilities",
  technicalConstraints: "Technical constraints",
  referenceWins: "Existing customers or reference wins",
  pricingModel: "Pricing model",
  typicalContractValue: "Typical contract value",
};

function parseList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatList(value: string[]) {
  return value.join(", ");
}

function GeneratedOrigin({
  metadata,
}: {
  metadata?: IcpFieldMetadata;
}) {
  if (!metadata) return null;
  return (
    <span>
      <span className="rounded-full bg-[#eef2fa] px-2 py-0.5 text-[10px] font-semibold text-[#66748b]">
        {metadata.origin === "Intake" ? "From intake" : metadata.origin}
      </span>
    </span>
  );
}

function Confidence({ value, reason }: { value?: number; reason?: string }) {
  if (value === undefined) return null;
  return (
    <span className="rounded-full bg-[#eef2fa] px-2 py-0.5 text-[10px] font-semibold text-[#66748b]">
      {reason ? `${value.toFixed(2)} confidence` : `${Math.round(value * 100)}% sample`}
    </span>
  );
}

function Field({
  label,
  optional,
  confidence,
  metadata,
  children,
}: {
  label: string;
  optional?: boolean;
  confidence?: number;
  metadata?: IcpFieldMetadata;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-2 flex min-h-5 items-center justify-between gap-2 text-[12px] font-semibold text-[#45536a]">
        <span>
          {label}
          {optional && (
            <span className="ml-1 font-normal text-[#9aa4b4]">Optional</span>
          )}
        </span>
        <span className="flex flex-wrap items-center justify-end gap-1">
          <GeneratedOrigin metadata={metadata} />
          <Confidence value={confidence} reason={metadata?.confidenceReason} />
        </span>
      </span>
      {children}
      {confidence !== undefined && metadata?.confidenceReason && (
        <span className="mt-1 block text-[10px] text-[#66748b]">{metadata.confidenceReason}</span>
      )}
      {metadata?.evidenceRefs && metadata.evidenceRefs.length > 0 && (
        <span className="mt-1 block text-[10px] text-[#8995a8]">
          Evidence: {metadata.evidenceRefs.map((field) => intakeFieldLabels[field]).join(", ")}
        </span>
      )}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-[#dfe5ef] bg-white px-3.5 py-3 text-[13px] text-[#26334a] outline-none transition placeholder:text-[#a0a9b8] focus:border-[#6387db] focus:ring-4 focus:ring-[#eaf0ff]";

function ListField({
  label,
  values,
  onChange,
  placeholder,
  confidence,
  metadata,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  confidence?: number;
  metadata?: IcpFieldMetadata;
}) {
  const parentValue = formatList(values);
  const [draft, setDraft] = useState({ text: parentValue, normalized: parentValue });

  if (parentValue !== draft.normalized) {
    setDraft({ text: parentValue, normalized: parentValue });
  }

  return (
    <Field label={label} optional confidence={confidence} metadata={metadata}>
      <textarea
        className={`${inputClass} min-h-[76px] resize-y leading-5`}
        value={draft.text}
        onChange={(event) => {
          const nextValue = event.target.value;
          const parsed = parseList(nextValue);
          setDraft({ text: nextValue, normalized: formatList(parsed) });
          onChange(parsed);
        }}
        placeholder={placeholder}
        rows={2}
      />
      <span className="mt-1.5 block text-[10px] text-[#9aa4b4]">
        Separate items with commas.
      </span>
    </Field>
  );
}

function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#edf2ff] text-[#5275cb]">
      {children}
    </span>
  );
}

function SectionTitle({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eef2fa] text-[11px] font-bold text-[#66748b]">
        {number}
      </span>
      <div>
        <h2 className="text-[14px] font-bold text-[#29364b]">{title}</h2>
        <p className="mt-0.5 text-[11px] text-[#8b96a8]">{detail}</p>
      </div>
    </div>
  );
}

export default function ProductIntakeWorkspace() {
  const findAccountsButton = useRef<HTMLButtonElement>(null);
  const adjacentResearchButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<WorkspaceView>("intake");
  const [history, setHistory] = useState<SavedHistory[]>([]);
  const [outreachMatch, setOutreachMatch] = useState("");
  const [product, setProduct] = useState<ProductIntake>(emptyProduct);
  const [profile, setProfile] = useState<IdealCustomerProfile | null>(null);
  const [sourceIntake, setSourceIntake] = useState<ProductIntake | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [needsReapproval, setNeedsReapproval] = useState(false);
  const [previouslyApproved, setPreviouslyApproved] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const isBusy = isGenerating || isChatting || isExpanding;
  const [generationError, setGenerationError] = useState("");
  const [ready, setReady] = useState(false);
  const [draftToResume, setDraftToResume] = useState<SavedWorkspace | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setProduct({ ...emptyProduct(), id: crypto.randomUUID() });
      try {
        setHistory(readHistory());
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (!isSavedWorkspace(parsed)) {
            throw new Error("Saved workspace data has an unsupported format.");
          }
          if (hasDraftWork(parsed.product, parsed.profile)) {
            setDraftToResume(parsed);
            setHistory(archiveWorkspace(parsed));
          }
        }
      } catch (error) {
        setStorageError(
          error instanceof Error
            ? error.message
            : "Saved workspace data could not be read.",
        );
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !autosaveEnabled) return;
    try {
      const saved: SavedWorkspace = {
        version: 1,
        product: intakeValues(product),
        profile,
        sourceIntake: sourceIntake && intakeValues(sourceIntake),
        approvedAt,
        needsReapproval,
        previouslyApproved,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      const entries = archiveWorkspace(saved);
      queueMicrotask(() => setHistory(entries));
    } catch (error) {
      const message =
        error instanceof Error
          ? `Local save failed: ${error.message}`
          : "Local save failed. Check this browser's storage settings.";
      queueMicrotask(() => setStorageError(message));
    }
  }, [
    product,
    profile,
    sourceIntake,
    approvedAt,
    needsReapproval,
    previouslyApproved,
    ready,
    autosaveEnabled,
  ]);

  function resumeDraft() {
    if (draftToResume) restoreWorkspace(draftToResume);
  }

  function restoreWorkspace(draft: SavedWorkspace) {
    setProduct(intakeValues(draft.product));
    setProfile(draft.profile);
    setSourceIntake(draft.profile ? intakeValues(draft.sourceIntake ?? draft.product) : null);
    setApprovedAt(draft.approvedAt);
    setNeedsReapproval(draft.needsReapproval);
    setPreviouslyApproved(draft.previouslyApproved ?? Boolean(draft.approvedAt || draft.needsReapproval));
    setGenerationError("");
    setDraftToResume(null);
    setAutosaveEnabled(true);
  }

  function startNewProduct() {
    if ((draftToResume || hasDraftWork(product, profile)) &&
      !window.confirm("Start a new product? Your saved intake and ICP will remain available in Product history.")) return;

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      setStorageError("The saved draft could not be cleared.");
      return;
    }
    setDraftToResume(null);
    setAutosaveEnabled(false);
    const id = crypto.randomUUID();
    setProduct({ ...emptyProduct(), id });
    setProfile(null);
    setSourceIntake(null);
    setApprovedAt(null);
    setNeedsReapproval(false);
    setPreviouslyApproved(false);
    setGenerationError("");
    setStorageError("");
  }

  function applyIntakePatch(patch: IntakePatch) {
    if (!Object.keys(patch).some((key) => {
      const field = key as keyof IntakePatch;
      return JSON.stringify(patch[field]) !== JSON.stringify(product[field]);
    })) return true;
    if (draftToResume && !window.confirm("Start this new intake? The saved draft will remain available in Product history.")) return false;
    setDraftToResume(null);
    setAutosaveEnabled(true);
    setStorageError("");
    setGenerationError("");
    setProduct((current) => ({ ...current, ...patch }));
    if (profile) {
      setApprovedAt(null);
      setNeedsReapproval(true);
    }
    return true;
  }

  function updateProduct<K extends ProductIntakeField>(key: K, value: ProductIntake[K]) {
    applyIntakePatch({ [key]: value });
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStorageError("");
    setGenerationError("");
    setIsGenerating(true);
    const submittedIntake = {
      ...intakeValues(product),
      id: product.id || crypto.randomUUID(),
    };

    try {
      const response = await fetch("/api/icp/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake: submittedIntake }),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("The generation service returned an unreadable response.");
      }

      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "ICP generation failed. Your saved data is unchanged.";
        throw new Error(message);
      }

      const result = IcpGenerationResponseSchema.safeParse(payload);
      if (!result.success) {
        throw new Error(
          "The generation service returned an invalid profile. Your saved data is unchanged.",
        );
      }

      const generated = result.data.profile;
      const profileId = profile?.id ?? crypto.randomUUID();
      const toMetadata = <Value,>(
        field: GeneratedIcpField<Value>, key: IcpProfileField,
      ): IcpFieldMetadata => ({
        origin: field.origin,
        evidenceRefs: field.evidenceRefs,
        confidenceReason: result.data.confidenceReasons?.[key],
      });
      setProduct(submittedIntake);
      setProfile({
        id: profileId,
        productId: submittedIntake.id,
        industries: generated.industries.value,
        classifications: {
          naics: generated.classifications.naics.value,
          sic: generated.classifications.sic.value,
        },
        headcountBand: generated.headcountBand.value,
        revenueBand: generated.revenueBand.value,
        buyerRoles: generated.buyerRoles.value,
        buyerSeniority: generated.buyerSeniority.value,
        buyingTriggers: generated.buyingTriggers.value,
        exclusions: generated.exclusions.value,
        generationSource: "live",
        targeting: profile?.targeting,
        confidence: result.data.confidence,
        references: result.data.references,
        marketEvidence: result.data.marketEvidence,
        referenceStatus: result.data.referenceStatus,
        fieldMetadata: {
          industries: toMetadata(generated.industries, "industries"),
          naics: toMetadata(generated.classifications.naics, "naics"),
          sic: toMetadata(generated.classifications.sic, "sic"),
          headcountBand: toMetadata(generated.headcountBand, "headcountBand"),
          revenueBand: toMetadata(generated.revenueBand, "revenueBand"),
          buyerRoles: toMetadata(generated.buyerRoles, "buyerRoles"),
          buyerSeniority: toMetadata(generated.buyerSeniority, "buyerSeniority"),
          buyingTriggers: toMetadata(generated.buyingTriggers, "buyingTriggers"),
          exclusions: toMetadata(generated.exclusions, "exclusions"),
        },
      });
      setSourceIntake(submittedIntake);
      setApprovedAt(null);
      setNeedsReapproval(true);
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : "ICP generation failed. Your saved data is unchanged.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function handleSampleGeneration() {
    setStorageError("");
    setGenerationError("");
    const nextProduct = {
      ...product,
      id: product.id || crypto.randomUUID(),
    };
    setProduct(nextProduct);
    setProfile((current) =>
      createSampleProfile(nextProduct.id, current?.id),
    );
    setSourceIntake(nextProduct);
    setApprovedAt(null);
    setNeedsReapproval(true);
  }

  function updateProfile<K extends keyof IdealCustomerProfile>(
    key: K,
    value: IdealCustomerProfile[K],
    profileField?: IcpProfileField,
  ) {
    setStorageError("");
    setGenerationError("");
    const metadataField = profileField ?? profileFieldByKey[key];
    setProfile((current) => {
      if (!current) return current;
      const acceptedSegments = current.acceptedSegments?.filter((segment) =>
        metadataField === "industries" ? (value as string[]).includes(segment.segment) :
        metadataField === "naics" ? (value as IdealCustomerProfile["classifications"]).naics.includes(segment.naics) :
        true,
      );
      const confidence = current.confidence
        ? { ...current.confidence }
        : undefined;
      const confidenceField = metadataField
        ? confidenceFieldByProfileField[metadataField]
        : undefined;
      if (confidence && confidenceField) {
        delete confidence[confidenceField];
        if (metadataField === "naics" || metadataField === "sic") delete confidence.classifications;
      }
      return {
        ...current,
        [key]: value,
        confidence,
        acceptedSegments,
        fieldMetadata: metadataField
          ? {
              ...current.fieldMetadata,
              [metadataField]: { origin: "Edited by you" },
            }
          : current.fieldMetadata,
      };
    });
    setApprovedAt(null);
    setNeedsReapproval(true);
  }

  function updateTargeting(key: keyof NonNullable<IdealCustomerProfile["targeting"]>, value: string[]) {
    updateProfile("targeting", {
      technology: [], painPoints: [], budget: [], decisionProcess: [],
      ...profile?.targeting,
      [key]: value,
    });
  }

  function updateClassification(kind: "naics" | "sic", value: string[]) {
    if (!profile) return;
    updateProfile("classifications", {
      ...profile.classifications,
      [kind]: value,
    }, kind);
  }

  function acceptSegment(hypothesis: Hypothesis) {
    setProfile((current) => {
      if (!current) return current;
      const confidence = { ...current.confidence };
      delete confidence.industries;
      delete confidence.naics;
      delete confidence.classifications;
      return {
        ...current,
        industries: [...new Set([...current.industries, hypothesis.segment])],
        classifications: { ...current.classifications, naics: [...new Set([...current.classifications.naics, hypothesis.naics])] },
        acceptedSegments: [...(current.acceptedSegments ?? []), hypothesis],
        confidence,
        fieldMetadata: { ...current.fieldMetadata, industries: { origin: "Edited by you" }, naics: { origin: "Edited by you" } },
      };
    });
    setApprovedAt(null);
    setNeedsReapproval(true);
  }

  function approveProfile() {
    setStorageError("");
    setApprovedAt(new Date().toISOString());
    setNeedsReapproval(false);
    setPreviouslyApproved(true);
  }

  const displayedConfidence = profile?.generationSource === "live"
    ? Object.fromEntries(Object.entries(profile.confidence ?? {}).filter(([field]) =>
      profile.fieldMetadata?.[field as IcpProfileField]?.confidenceReason))
    : profile?.confidence;
  const approved = Boolean(approvedAt);
  const discoveryRequest = profile && approvedAt && !needsReapproval &&
    profile.productId === product.id && sourceIntake && JSON.stringify(sourceIntake) === JSON.stringify(product)
    ? DiscoveryRequestSchema.safeParse({
      productId: product.id, profileId: profile.id, productName: product.name, approvedAt,
      industries: profile.industries, buyerRoles: profile.buyerRoles,
      buyingTriggers: profile.buyingTriggers, exclusions: profile.exclusions, targeting: profile.targeting,
    })
    : null;


  const viewLabel = workspaceViews.find(([id]) => id === view)?.[1];
  const graphView = view === "graph" || view === "competition";

  function renderNavigation() {
    return workspaceViews.map(([id, label]) => <button key={id} type="button"
      onClick={() => { if (id === "outreach") setOutreachMatch(""); setView(id); }}
      aria-current={view === id ? "page" : undefined}
      className="min-h-10 rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#435975] hover:bg-[#eff5fd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#31569e] aria-[current=page]:bg-[#e4efff] aria-[current=page]:text-[#21477e] sm:text-sm lg:w-full">
      {label}
    </button>);
  }

  return (
    <div className={`min-h-screen text-[#243550] ${graphView ? "bg-[#f5f7fb]" : "bg-[#edf3f9]"}`}>
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-[224px] flex-col overflow-y-auto border-r border-[#dbe5f1] bg-white lg:flex">
        <div className="flex h-[76px] shrink-0 items-center gap-3 border-b border-[#e5edf7] px-5">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#31569e] text-lg font-bold text-white">A</span>
          <p className="text-base font-bold tracking-tight text-[#172b49]">Atlas GTM</p>
        </div>
        <nav className="space-y-1 px-3 py-5" aria-label="Workspace">
          <p className="px-3 pb-2 text-xs font-semibold text-[#536780]">Workspace</p>
          {renderNavigation()}
        </nav>
      </aside>

      <div className="min-w-0 lg:pl-[224px]">
        <header className="flex min-h-[66px] flex-wrap items-center justify-between gap-2 border-b border-[#dbe5f1] bg-white px-4 py-3 sm:px-8 lg:px-10">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-[#536780]">Atlas GTM</span>
            <span aria-hidden="true" className="text-[#8092a8]">/</span>
            <span className="font-semibold text-[#243550]">{viewLabel}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#dbe5f1] bg-[#f5f9fe] px-3 py-1.5 text-xs font-medium text-[#435975]">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#378564]" />
            {storageError ? "Storage issue" : !ready ? "Loading workspace" : autosaveEnabled ? "Saved locally" : draftToResume ? "Saved draft available" : "New workspace"}
          </div>
        </header>
        <nav className="flex flex-wrap gap-1 border-b border-[#dbe5f1] bg-white px-3 py-2 lg:hidden" aria-label="Workspace">
          {renderNavigation()}
        </nav>
        <div hidden={view !== "discovery"}>
          <AccountDiscovery key={discoveryRequest?.success ? JSON.stringify(discoveryRequest.data) : product.id}
            productId={product.id} active={view === "discovery"} request={discoveryRequest?.success ? discoveryRequest.data : null} searchButtonRef={findAccountsButton} onReview={() => setView("intake")} />
        </div>
        {view === "competition" && (
          <CompetitiveLandscape key={JSON.stringify([product.id, product.name, product.description, product.capabilities])} onIntake={() => setView("intake")} product={{
            productId: product.id, productName: product.name, description: product.description, capabilities: product.capabilities,
          }} />
        )}
        {view === "graph" && <KnowledgeGraph key={product.id} productId={product.id} productName={product.name}
          onOutreach={(matchId) => { setOutreachMatch(matchId); setView("outreach"); }} />}
        {view === "outreach" && product.id && <OutreachWorkspace key={product.id} productId={product.id}
          initialMatch={outreachMatch} onIntake={() => setView("intake")} onDiscovery={() => setView("discovery")} />}
        {view === "pipeline" && product.id && <PipelineWorkspace key={product.id} productId={product.id} onIntake={() => setView("intake")} onDiscovery={() => setView("discovery")} />}
        {view === "history" && <ProductHistory entries={history.map(({ id, savedAt, draft }) => ({
          id, savedAt, productId: draft.product.id, productName: draft.product.name,
          profileName: draft.profile ? "Saved ICP" : "Intake only",
          approvedAt: draft.approvedAt, needsReapproval: draft.needsReapproval,
        }))} onOpen={(id) => {
          const entry = history.find((item) => item.id === id);
          if (entry) { restoreWorkspace(entry.draft); setView("intake"); }
        }} />}
        <main id="product-intake" hidden={view !== "intake"} className={demoPageClass}>
          <DemoPageHeader title="Product intake & ICP" description="Describe what you offer, then review the customer profile before searching for accounts."
            action={<>
              {draftToResume
                ? <button key="resume" type="button" onClick={resumeDraft} disabled={isBusy} className={primaryClass}>Resume draft</button>
                : <button key="generate" type="submit" form="atlas-product-intake" disabled={!ready || isBusy} className={primaryClass}>
                    {isGenerating ? "Generating…" : "Generate ICP"}
                  </button>}
              <button type="button" onClick={startNewProduct} disabled={!ready || isBusy} className={controlClass}>New product</button>
            </>} />

          {storageError && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-[#f0c9bd] bg-[#fff7f4] px-4 py-3 text-[12px] text-[#9a4835]"
            >
              {storageError}
            </div>
          )}

          <div className="min-w-0">
            <IntakeChat key={product.id} product={product} disabled={!ready || isBusy} onBusy={setIsChatting} onUpdate={applyIntakePatch} />
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <section className="overflow-hidden rounded-xl border border-[#e5eaf2] bg-white shadow-[0_2px_8px_rgba(27,45,78,0.025)]">
              <div className="flex items-center justify-between border-b border-[#edf0f5] px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <Mark>◈</Mark>
                  <div>
                    <h2 className="text-[14px] font-bold text-[#29364b]">Product intake</h2>
                    <p className="mt-0.5 text-[10px] text-[#929daf]">
                      Describe the product in your own words
                    </p>
                  </div>
                </div>
              </div>

              <form
                id="atlas-product-intake"
                onSubmit={handleGenerate}
                aria-busy={isGenerating}
                className="space-y-5 px-5 py-5 sm:px-6"
              >
                <fieldset disabled={!ready || isBusy} className="min-w-0 space-y-5">
                <SectionTitle
                  number="A"
                  title="What are you building?"
                  detail="A clear explanation is more useful than polished copy."
                />
                <Field label="Product name">
                  <input
                    className={inputClass}
                    value={product.name}
                    onChange={(event) => updateProduct("name", event.target.value)}
                    placeholder="e.g. Northstar"
                    required
                    maxLength={120}
                  />
                </Field>
                <Field label="Plain-language description">
                  <textarea
                    className={`${inputClass} min-h-[108px] resize-y leading-5`}
                    value={product.description}
                    onChange={(event) => updateProduct("description", event.target.value)}
                    placeholder="What does it do, who uses it, and what problem does it solve?"
                    required
                    maxLength={2000}
                  />
                </Field>

                <div className="border-t border-[#edf0f5] pt-5">
                  <SectionTitle
                    number="B"
                    title="Add useful context"
                    detail="Optional details help make the first profile more relevant."
                  />
                </div>
                <ListField
                  label="Capabilities"
                  values={product.capabilities}
                  onChange={(value) => updateProduct("capabilities", value)}
                  placeholder="What can customers do with it?"
                />
                <ListField
                  label="Technical constraints"
                  values={product.technicalConstraints}
                  onChange={(value) => updateProduct("technicalConstraints", value)}
                  placeholder="Required systems, integrations, regions, or limitations"
                />
                <ListField
                  label="Existing customers or reference wins"
                  values={product.referenceWins}
                  onChange={(value) => updateProduct("referenceWins", value)}
                  placeholder="Customer types, use cases, or outcomes you can share"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Pricing model" optional>
                    <input
                      className={inputClass}
                      value={product.pricingModel}
                      onChange={(event) => updateProduct("pricingModel", event.target.value)}
                      placeholder="Subscription, usage-based, services…"
                    />
                  </Field>
                  <Field label="Typical contract value" optional>
                    <input
                      className={inputClass}
                      value={product.typicalContractValue}
                      onChange={(event) =>
                        updateProduct("typicalContractValue", event.target.value)
                      }
                      placeholder="e.g. $24k–$60k annually"
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f5] pt-5">
                  <p className="text-[10px] text-[#9aa4b4]">
                    Live generation uses a server-side API key. Sample output needs no credentials.
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleSampleGeneration}
                      disabled={!product.name.trim() || !product.description.trim()}
                      className="rounded-lg border border-[#dfe5ef] bg-white px-3.5 py-2.5 text-[11px] font-semibold text-[#56647a] transition hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Use sample ICP
                    </button>
                  </div>
                </div>
                {product.id && (
                  <p className="text-[9px] text-[#b0b8c5]">Product ID · {product.id}</p>
                )}
                </fieldset>
                {generationError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-[#f0c9bd] bg-[#fff7f4] px-3.5 py-3 text-[11px] leading-5 text-[#9a4835]"
                  >
                    {generationError}
                  </div>
                )}
              </form>
            </section>

            <section id="icp-review" className="overflow-hidden rounded-xl border border-[#e5eaf2] bg-white shadow-[0_2px_8px_rgba(27,45,78,0.025)]">
              <div className="flex items-center justify-between border-b border-[#edf0f5] px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <Mark>◎</Mark>
                  <div>
                    <h2 className="text-[14px] font-bold text-[#29364b]">
                      ICP review
                    </h2>
                    <p className="mt-0.5 text-[10px] text-[#929daf]">
                      Review and refine the target customer
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-[#e5eaf2] px-2.5 py-1 text-[9px] font-semibold text-[#8793a7]">
                  {profile ? "Editable" : "Needs intake"}
                </span>
              </div>

              {profile ? (
                <fieldset disabled={isBusy} className="contents">
                  <div className="mx-5 mt-5 flex items-start gap-3 rounded-lg border border-[#e7ecf7] bg-[#f7f9fd] p-3.5 sm:mx-6">
                    <span className="mt-0.5 text-[#617fbe]">✳</span>
                    <div>
                      <p className="text-[11px] font-semibold text-[#4c5d79]">
                        {profile.generationSource === "live"
                          ? "AI-generated draft"
                          : "Illustrative sample output"}
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-[#8490a4]">
                        {profile.generationSource === "live"
                          ? "Generated from the submitted intake. Review each origin and evidence reference before approval."
                          : "Example hypotheses only. No model is connected; adjust every field before approval."}
                      </p>
                    </div>
                  </div>
                  {profile.generationSource === "live" && Boolean(sourceIntake?.referenceWins.some((win) => win.trim())) && (
                    <div className="mx-5 mt-4 space-y-2 rounded-lg border border-[#e5eaf2] p-3 text-xs sm:mx-6">
                      <h3 className="font-semibold">Reference evidence</h3>
                      {profile.referenceStatus === "unconfigured" && <p>Configure Crunchbase or Explorium to verify reference companies.</p>}
                      {profile.referenceStatus === "partial" && <p>Some enrichment data could not be retrieved. Scores use available evidence.</p>}
                      {profile.references?.map((reference) => (
                        <p key={reference.domain}>
                          <a href={reference.url} target="_blank" rel="noreferrer" className="text-[#31569e] underline">{reference.name}</a>
                          {[
                            reference.domain,
                            reference.headcountBand && `${reference.headcountBand} employees`,
                            reference.revenueBand && `Revenue ${reference.revenueBand}`,
                            reference.fundingDate && `Last funding ${reference.fundingDate}`,
                            reference.naics2017 && `2017 NAICS ${reference.naics2017}`,
                            reference.sic && `SIC ${reference.sic}`,
                            ...reference.industries,
                            reference.techStack?.length && `Tech stack ${reference.techStack.join(", ")}`,
                          ].filter(Boolean).map((detail, index) => <span key={index}> · {detail}</span>)}
                          {reference.linkedinUrl && <> · <a href={reference.linkedinUrl} target="_blank" rel="noreferrer" className="underline">LinkedIn</a></>}
                          {reference.fundingUrl && <> · <a href={reference.fundingUrl} target="_blank" rel="noreferrer" className="underline">Crunchbase</a></>}
                        </p>
                      ))}
                      {(profile.referenceStatus === "checked" || profile.referenceStatus === "partial") && sourceIntake?.referenceWins
                        .filter((win) => !profile.references?.some((reference) => reference.input === win))
                        .map((win, index) => <p key={index}>Unresolved · {win}</p>)}
                    </div>
                  )}
                  {!!profile.marketEvidence?.length && (
                    <div className="mx-5 mt-4 space-y-2 rounded-lg border border-[#e5eaf2] p-3 text-xs sm:mx-6">
                      <h3 className="font-semibold">Market evidence</h3>
                      {profile.marketEvidence.map((work) => (
                        <p key={`${work.industry}-${work.id}`}>{work.industry} · <a href={work.id} target="_blank" rel="noreferrer" className="text-[#31569e] underline">{work.title}</a></p>
                      ))}
                    </div>
                  )}
                  {!!profile.acceptedSegments?.length && (
                    <div className="mx-5 mt-4 space-y-2 rounded-lg border border-[#e5eaf2] p-3 text-xs sm:mx-6">
                      <h3 className="font-semibold">Accepted segment evidence</h3>
                      {profile.acceptedSegments.map((hypothesis, index) => (
                        <div key={index}>
                          <p>{hypothesis.segment} · NAICS {hypothesis.naics}{hypothesis.targetHeadcount && ` · ${hypothesis.targetHeadcount} employees`}</p>
                          <p>{hypothesis.rationale}</p>
                          {hypothesis.evidence.map((work) => (
                            <p key={work.id}><a href={work.id} target="_blank" rel="noreferrer" className="text-[#31569e] underline">{work.title}</a></p>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="space-y-5 px-5 py-5 sm:px-6">
                    <SectionTitle
                      number="1"
                      title="Firmographics"
                      detail="Organization attributes that may indicate a fit."
                    />
                    <ListField
                      label="Target industries"
                      values={profile.industries}
                      onChange={(value) => updateProfile("industries", value)}
                      placeholder="Add industries"
                      confidence={displayedConfidence?.industries}
                      metadata={profile.fieldMetadata?.industries}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <ListField
                        label="NAICS classifications"
                        values={profile.classifications.naics}
                        onChange={(value) => updateClassification("naics", value)}
                        placeholder="Codes or descriptions"
                        confidence={displayedConfidence?.naics ?? displayedConfidence?.classifications}
                        metadata={profile.fieldMetadata?.naics}
                      />
                      <ListField
                        label="SIC classifications"
                        values={profile.classifications.sic}
                        onChange={(value) => updateClassification("sic", value)}
                        placeholder="Codes or descriptions"
                        confidence={displayedConfidence?.sic ?? displayedConfidence?.classifications}
                        metadata={profile.fieldMetadata?.sic}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Headcount band"
                        confidence={displayedConfidence?.headcountBand}
                        metadata={profile.fieldMetadata?.headcountBand}
                      >
                        <input
                          className={inputClass}
                          value={profile.headcountBand}
                          onChange={(event) => updateProfile("headcountBand", event.target.value)}
                          placeholder="e.g. 50–500 employees"
                        />
                      </Field>
                      <Field
                        label="Revenue band"
                        confidence={displayedConfidence?.revenueBand}
                        metadata={profile.fieldMetadata?.revenueBand}
                      >
                        <input
                          className={inputClass}
                          value={profile.revenueBand}
                          onChange={(event) => updateProfile("revenueBand", event.target.value)}
                          placeholder="e.g. $10M–$100M annually"
                        />
                      </Field>
                    </div>

                    <div className="border-t border-[#edf0f5] pt-5">
                      <SectionTitle number="2" title="Technographics" detail="Technology requirements or preferences for the target account." />
                    </div>
                    <ListField label="Target technologies" values={profile.targeting?.technology ?? []}
                      onChange={(value) => updateTargeting("technology", value)} placeholder="Required integrations or tools" />

                    <div className="border-t border-[#edf0f5] pt-5">
                      <SectionTitle number="3" title="Pain Points & Triggers" detail="Operational problems and events that qualify an account." />
                    </div>
                    <ListField label="Pain points" values={profile.targeting?.painPoints ?? []}
                      onChange={(value) => updateTargeting("painPoints", value)} placeholder="Problems the account needs to solve" />
                    <ListField
                      label="Buying triggers"
                      values={profile.buyingTriggers}
                      onChange={(value) => updateProfile("buyingTriggers", value)}
                      placeholder="Events or needs that create a reason to buy"
                      confidence={displayedConfidence?.buyingTriggers}
                      metadata={profile.fieldMetadata?.buyingTriggers}
                    />
                    <ListField
                      label="Exclusions"
                      values={profile.exclusions}
                      onChange={(value) => updateProfile("exclusions", value)}
                      placeholder="Organizations or situations that are not a fit"
                      confidence={displayedConfidence?.exclusions}
                      metadata={profile.fieldMetadata?.exclusions}
                    />

                    <div className="border-t border-[#edf0f5] pt-5">
                      <SectionTitle number="4" title="Budget & Decision-Making" detail="Budget signals, stakeholders, and purchase criteria." />
                    </div>
                    <ListField label="Target budget" values={profile.targeting?.budget ?? []}
                      onChange={(value) => updateTargeting("budget", value)} placeholder="Known budget range or buying constraints" />
                    <ListField label="Decision process" values={profile.targeting?.decisionProcess ?? []}
                      onChange={(value) => updateTargeting("decisionProcess", value)} placeholder="Approval steps or decision criteria" />
                    <ListField
                      label="Buyer roles"
                      values={profile.buyerRoles}
                      onChange={(value) => updateProfile("buyerRoles", value)}
                      placeholder="Job functions or role names"
                      confidence={displayedConfidence?.buyerRoles}
                      metadata={profile.fieldMetadata?.buyerRoles}
                    />
                    <ListField
                      label="Buyer seniority"
                      values={profile.buyerSeniority}
                      onChange={(value) => updateProfile("buyerSeniority", value)}
                      placeholder="e.g. Manager, Director, VP"
                      confidence={displayedConfidence?.buyerSeniority}
                      metadata={profile.fieldMetadata?.buyerSeniority}
                    />

                    {profile.generationSource !== "live" && profile.confidence && (
                    <div className="rounded-lg border border-[#edf0f5] bg-[#fafbfd] p-3 text-[9px] leading-4 text-[#8995a8]">
                      <span className="font-semibold text-[#66748b]">Sample confidence</span>
                      {" "}is an illustrative 0–1 estimate for the future model output, displayed here as a percentage. It is not a measured prediction.
                    </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f5] pt-5">
                      <div className="min-w-0">
                        <p
                          className={`text-[11px] font-semibold ${approved ? "text-[#378564]" : needsReapproval ? "text-[#a76d1f]" : "text-[#69768b]"}`}
                        >
                          {approved
                            ? "ICP approved"
                            : needsReapproval
                              ? "Changes require approval"
                              : "Review the profile before approving"}
                        </p>
                        <p className="mt-1 truncate text-[9px] text-[#a0a9b8]">
                          ICP ID · {profile.id}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={approveProfile}
                        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-semibold text-white transition focus:outline-none focus:ring-4 ${
                          approved
                            ? "cursor-default bg-[#438b6d] focus:ring-[#e2f2eb]"
                            : "bg-[#31569e] hover:bg-[#284986] focus:ring-[#e1eaff]"
                        }`}
                      >
                        {approved
                          ? "Approved"
                          : previouslyApproved
                            ? "Reapprove ICP"
                            : "Approve ICP"}
                        {!approved && <span aria-hidden="true">✓</span>}
                      </button>
                    </div>
                    {approved && !needsReapproval && (
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" className={primaryClass} disabled={!discoveryRequest?.success} onClick={() => {
                          setView("discovery");
                          findAccountsButton.current?.click();
                        }}>Find accounts</button>
                        {profile.generationSource === "live" && sourceIntake && <button type="button" className={`${controlClass} px-4 py-2.5`}
                          disabled={isBusy} onClick={() => {
                            document.getElementById("adjacent-markets")?.scrollIntoView({ block: "start" });
                            adjacentResearchButton.current?.click();
                          }}>Explore adjacent markets</button>}
                      </div>
                    )}
                    {approvedAt && (
                      <p className="text-right text-[9px] text-[#a0a9b8]">
                        Approved {new Date(approvedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </fieldset>
              ) : (
                <div className="flex min-h-[260px] flex-col items-center justify-center px-8 py-12 text-center sm:min-h-[360px]">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1f4fa] text-[21px] text-[#8da0c5]">
                    ◎
                  </div>
                  <h3 className="text-[13px] font-semibold text-[#4b5970]">
                    Your customer profile starts here
                  </h3>
                  <p className="mt-2 max-w-[270px] text-[11px] leading-5 text-[#929daf]">
                    Complete the product details and generate an editable ICP, or use sample output without credentials.
                  </p>
                  <div className="mt-5 flex items-center gap-2 text-[9px] font-medium text-[#a1aaba]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#7d9de2]" />
                    No API key required
                  </div>
                </div>
              )}
            </section>
          </div>
          {profile?.generationSource === "live" && sourceIntake && (
            <IcpExpansion key={JSON.stringify([sourceIntake, profile.id])} intake={sourceIntake} industries={profile.industries}
              disabled={isBusy || JSON.stringify(sourceIntake) !== JSON.stringify(product)}
              researchButtonRef={adjacentResearchButton} onBusy={setIsExpanding} onAccept={acceptSegment} />
          )}
          <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] text-[#a2adbd]">
            <span>Atlas GTM · Module 1</span>
            <span>Drafts are saved in this browser; live generation sends submitted intake to OpenAI</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
