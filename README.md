# Atlas GTM

Module 1 turns product intake into an editable ideal customer profile. Run `npm install` and `npm run dev`, then open the local address printed by Next.js.

## Service configuration

Add credentials to `.env.local` on the server.

| Variable | Used for |
| --- | --- |
| `OPENAI_API_KEY` | Structured intake chat, ICP generation, expansion assessment, and graph embeddings. The sample workflow runs without credentials. |
| `CRUNCHBASE_API_KEY` | Domain-matched company categories, estimated employee and revenue ranges, and the most recent funding date where available. |
| `EXPLORIUM_API_KEY` | Domain-matched LinkedIn company profiles, 2017 NAICS and SIC codes, size and revenue bands, and reported tech stacks. Proxycurl closed, so this integration uses Explorium for these records. |
| `OPENALEX_API_KEY` | Optional API key for OpenAlex searches. Keyless requests use OpenAlex’s anonymous budget. |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | Optional graph storage for accepted segments. Use a database with native vector index support and permissions to create indexes and constraints. |
| `NEO4J_DATABASE` | Optional database name. When blank, the driver selects the account’s home database. |

## Workflow

1. Describe the product in chat or edit the intake form. Chat updates the form after each answer and asks for the next missing item.
2. Add a company website domain to each reference win, for example `Acme (acme.example)`. Domain matches supply evidence, and unresolved entries appear in the profile for review.
3. Generate an ICP. Field confidence is an evidence score on a 0.00–1.00 scale. The server computes `0.50 × intake explicitness + 0.35 × reference overlap + 0.15 × market corroboration`.
   - Intake explicitness is 1.00 for a verbatim founder claim, 0.70 for an intake-linked hypothesis, and 0.20 for an unsupported hypothesis.
   - Reference overlap is the fraction of two distinct company domains that corroborate every value in the field, capped at 1.00. It applies where provider data is directly comparable.
   - Market corroboration requires a retrieved work that mentions the industry and a stated capability. Every industry in a field must be corroborated to earn full market credit. Other fields currently receive zero market credit.
   - High scores (0.85–1.00) require explicit founder input and at least two matching references. Medium scores (0.50–0.84) reflect partial evidence, including intake-linked hypotheses with market corroboration. Low scores (below 0.50) need validation. Blank fields have no score. Manual edits clear the affected score.
4. Research adjacent segments from the generated profile. LangGraph plans candidates, retrieves OpenAlex papers and official 2022 NAICS classifications, then assesses candidate evidence. Accept a card to add the segment and NAICS code to the ICP, edit its targeting parameters, or dismiss it with a reason. Dismissal reasons guide future research in this browser.
5. With Neo4j configured, accepting a card records `ProductCapability → PainPoint → NaicsIndustry` and indexes the pain point embedding using Neo4j’s native vector index. The browser keeps the intake, profile, accepted evidence, and approvals.

NAICS versions are kept distinct. The bundled 2022 code list comes from the [U.S. Census Bureau](https://www.census.gov/naics/2022NAICS/6-digit_2022_Codes.xlsx). Reference codes from Explorium are labeled 2017.

## Account discovery

Set `TAVILY_API_KEY` in `.env.local` and restart the app. Discovery also uses the existing server-side OpenAI configuration to assess retrieved evidence. Open **Account discovery** after approving the current ICP. Search cards show an observation, its exact excerpt, the original source, the retrieval date, and a separately labeled fit inference. Confirmed exclusions are listed with their evidence. When a first-party page identifies a Greenhouse board, discovery can use its public jobs feed without a separate key.

ICP Review groups targeting criteria into Firmographics, Technographics, Pain Points & Triggers, and Budget & Decision-Making. Changes require reapproval. Account details show sourced observations in the same categories and label missing information as unknown. Buyer discovery displays names only when an employer source supports the current name and title. Suggested roles are hypotheses.

Competitive Landscape researches official product pages, documentation, and pricing pages. The map uses validated records keyed by product ID and competitor domain, with evidence attached to each claim. Direct, Indirect, and Alternative describe inferred relationships to the founder’s product. Competitor graph persistence remains separate from the account-match graph.


## Dynamic Knowledge Graph

Save a source-backed result from Account Discovery, then open **Knowledge graph** for the same product. The server signs the validated observation and its approved targeting version and uses stable IDs for the product, company, approved version, match, and evidence. A repeated save reuses those records and keeps the original retrieval timestamp. Neo4j stores the match inference separately from the quoted observation. The workspace is a single-user prototype and browser approval is local.

Buyer research saves sourced current employment as `WORKS_AT`; title hypotheses stay in the results only. Competitive research saves `COMPETES_WITH` classifications and keeps source-backed research snapshots. Company details traverse the product's approved ICP versions to matched companies, evidence, and verified current buyers. Warm introductions require sourced employment overlap.

The long-running Next.js Node server checks due account sources every six hours by default. Set `ATLAS_SIGNAL_REFRESH_MINUTES` to change the interval (minimum 1 minute), or `ATLAS_SIGNAL_REFRESH_DISABLED=1` to disable scheduled checks. **Refresh signals** immediately checks the current product. Each batch checks up to 16 match/source pairs, keeps older evidence, and records the last check even when retrieval fails. Run the scheduler on one always-on server instance.

## Outreach preview and test delivery

Open a saved company in **Knowledge graph** to draft an email from its saved source. Save any edits and approve the exact version before using the independent sandbox and test-email actions. The server records versioned draft, approval, sandbox validation, and test-send acceptance events in Neo4j. A SendGrid acceptance records API acceptance, not inbox delivery.

Set `HUNTER_API_KEY` for work-email enrichment of verified named buyers. `SENDGRID_API_KEY`, `OUTREACH_FROM_EMAIL` (a verified sender), and `OUTREACH_TEST_RECIPIENT` enable testing. Both mail actions use only the configured inbox as their envelope recipient. The prototype has no prospect-send action. Use it in the local, single-user workspace.
