import { z } from "zod";

export const ReferenceSchema = z.object({
  input: z.string(),
  name: z.string(),
  domain: z.string(),
  url: z.url(),
  headcountBand: z.string().optional(),
  revenueBand: z.string().optional(),
  fundingDate: z.string().optional(),
  industries: z.array(z.string()),
  fundingUrl: z.url().optional(),
  linkedinUrl: z.url().optional(),
  naics2017: z.string().optional(),
  sic: z.string().optional(),
  techStack: z.array(z.string()).optional(),
});

export type Reference = z.infer<typeof ReferenceSchema>;

const CrunchbaseResults = z.object({
  entities: z.array(z.object({
    properties: z.object({
      identifier: z.object({ value: z.string(), permalink: z.string() }),
      website_url: z.string().nullish(),
      num_employees_enum: z.string().nullish(),
      revenue_range: z.string().nullish(),
      last_funding_at: z.string().nullish(),
      categories: z.array(z.object({ value: z.string() })).nullish(),
    }),
  })),
});

function hostname(value: string) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function resolveReferences(wins: string[]) {
  const domains = new Map<string, string>();
  for (const input of wins) {
    const candidate = input.match(/(?:https?:\/\/)?(?:[a-z\d-]+\.)+[a-z]{2,}(?=[\s)/,;:]|$)/i)?.[0];
    const domain = candidate ? hostname(candidate) : "";
    if (domain && domain !== "linkedin.com") domains.set(domain, input);
  }
  if (!domains.size) return { references: [], partial: false };

  const providers = await Promise.allSettled([
    process.env.CRUNCHBASE_API_KEY ? searchCrunchbase(domains, process.env.CRUNCHBASE_API_KEY) : [],
    process.env.EXPLORIUM_API_KEY ? searchExplorium(domains, process.env.EXPLORIUM_API_KEY) : { references: [], partial: false },
  ] as const);
  if (providers.every((provider) => provider.status === "rejected")) throw new Error("Reference providers unavailable");
  const [crunchbase, explorium] = providers;
  const references = new Map((crunchbase.status === "fulfilled" ? crunchbase.value : []).map((reference) => [reference.domain, reference]));
  for (const reference of explorium.status === "fulfilled" ? explorium.value.references : []) {
    const company = references.get(reference.domain);
    references.set(reference.domain, {
      ...reference,
      headcountBand: reference.headcountBand ?? company?.headcountBand,
      revenueBand: reference.revenueBand ?? company?.revenueBand,
      industries: [...new Set([...reference.industries, ...(company?.industries ?? [])])],
      fundingDate: company?.fundingDate,
      fundingUrl: company?.url,
    });
  }
  return {
    references: [...references.values()],
    partial: providers.some((provider) => provider.status === "rejected") || (explorium.status === "fulfilled" && explorium.value.partial),
  };
}

async function searchCrunchbase(domains: Map<string, string>, key: string) {
  const response = await fetch("https://api.crunchbase.com/v4/data/searches/organizations", {
    method: "POST",
    headers: { "X-cb-user-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      field_ids: ["identifier", "website_url", "num_employees_enum", "revenue_range", "last_funding_at", "categories"],
      query: [{ type: "predicate", field_id: "website_url", operator_id: "domain_includes", values: [...domains.keys()] }],
      limit: 50,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Crunchbase reference lookup failed");
  const { entities } = CrunchbaseResults.parse(await response.json());

  return [...domains].flatMap(([domain, input]): Reference[] => {
    const matches = entities.filter(({ properties }) => hostname(properties.website_url ?? "") === domain);
    if (matches.length !== 1) return [];
    const company = matches[0].properties;
    return [{
      input,
      domain,
      name: company.identifier.value,
      url: `https://www.crunchbase.com/organization/${encodeURIComponent(company.identifier.permalink)}`,
      headcountBand: company.num_employees_enum?.replace(/^c_/, "").replace("_", "–"),
      revenueBand: company.revenue_range?.replaceAll("_", " "),
      fundingDate: company.last_funding_at ?? undefined,
      industries: company.categories?.map((category) => category.value) ?? [],
    }];
  });
}

const Firmographics = z.object({
  data: z.array(z.object({
    input: z.object({ domain: z.string() }),
    business_id: z.string().regex(/^[a-f0-9]{32}$/).nullable(),
    data: z.object({
      name: z.string().nullish(),
      website: z.string().nullish(),
      linkedin_profile: z.string().nullish(),
      linkedin_industry_category: z.string().nullish(),
      naics: z.string().regex(/^\d{6}$/).nullish().catch(undefined),
      naics_description: z.string().nullish(),
      sic_code: z.string().regex(/^\d{4}$/).nullish().catch(undefined),
      number_of_employees_range: z.string().nullish(),
      yearly_revenue_range: z.string().nullish(),
    }).nullable(),
  })),
});
const Technographics = z.object({
  data: z.array(z.object({
    business_id: z.string(),
    data: z.object({ full_tech_stack: z.array(z.string()).nullish() }).nullish(),
  })),
});

async function searchExplorium(domains: Map<string, string>, key: string) {
  async function enrich(kind: "firmographics" | "technographics", body: object) {
    const response = await fetch(`https://api.explorium.ai/v2/businesses/${kind}/enrich`, {
      method: "POST",
      headers: { api_key: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Explorium ${kind} failed`);
    return response.json();
  }

  const firmographics = Firmographics.parse(await enrich("firmographics", {
    businesses_to_match: [...domains.keys()].map((domain) => ({ domain })),
  }));
  const matches = firmographics.data.flatMap(({ input, data, business_id }) =>
    data?.name && domains.has(input.domain) && hostname(data.website ?? "") === input.domain && business_id
      ? [{ input, data, business_id, name: data.name }]
      : [],
  );
  if (!matches.length) return { references: [], partial: false };

  let partial = false;
  const technologies = await enrich("technographics", { business_ids: [...new Set(matches.map((match) => match.business_id))] })
    .then((data) => Technographics.parse(data).data)
    .catch(() => { partial = true; return []; });
  const techById = new Map(technologies.map(({ business_id, data }) => [business_id, data?.full_tech_stack]));
  const references = matches.map(({ input, data, business_id, name }): Reference => ({
    input: domains.get(input.domain)!,
    name,
    domain: input.domain,
    url: "https://developers.explorium.ai/v2/businesses/enrichments/firmographics_enrich",
    linkedinUrl: data.linkedin_profile?.startsWith("https://www.linkedin.com/company/") ? data.linkedin_profile : undefined,
    industries: [data.linkedin_industry_category, data.naics_description].filter((industry): industry is string => Boolean(industry)),
    headcountBand: data.number_of_employees_range ?? undefined,
    revenueBand: data.yearly_revenue_range ?? undefined,
    naics2017: data.naics ?? undefined,
    sic: data.sic_code ?? undefined,
    techStack: techById.get(business_id)?.slice(0, 50) ?? undefined,
  }));
  return { references, partial };
}
