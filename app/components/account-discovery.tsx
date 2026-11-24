"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { BandReview } from "./band-review";
import { AccountBuyers } from "./account-buyers";
import { SourceEvidence } from "./source-evidence";
import { GraphResponse } from "@/app/lib/graph-schema";
import { DemoPageHeader, demoPageClass } from "./demo-page";
import { controlClass, primaryClass, sectionClass } from "./workspace-styles";
import { DiscoveryResultSchema, IcpCategories, type DiscoveryRequest } from "@/app/lib/discovery-schema";
import type { z } from "zod";

type SaveState = { state: "saving" | "saved" } | { state: "error"; message: string };

type SavedMatch = z.infer<typeof GraphResponse>["matches"][number];

function accountDomain(domain: string) {
  return domain.toLowerCase().replace(/^www\./, "");
}

export function AccountDiscovery({ productId, active, request, onReview, searchButtonRef }: {
  productId: string;
  active: boolean;
  request: DiscoveryRequest | null;
  onReview: () => void;
  searchButtonRef?: Ref<HTMLButtonElement>;
}) {
  const [result, setResult] = useState<z.infer<typeof DiscoveryResultSchema> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedMatches, setSavedMatches] = useState<SavedMatch[] | null>(null);
  const [savedError, setSavedError] = useState("");
  const [savedRevision, setSavedRevision] = useState(0);
  const savedDomains = new Set(savedMatches?.map(({ domain }) => accountDomain(domain)));

  useEffect(() => {
    if (!active || !productId) return;
    const controller = new AbortController();
    async function loadSavedMatches() {
      try {
        const response = await fetch(`/api/graph?${new URLSearchParams({ productId })}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Saved matches could not be loaded.");
        const { matches } = GraphResponse.parse(payload);
        if (controller.signal.aborted) return;
        setSavedMatches(matches);
        setSavedError("");
      } catch (failure) {
        if (controller.signal.aborted) return;
        setSavedError(failure instanceof Error && failure.name !== "ZodError"
          ? failure.message : "Saved matches could not be loaded.");
      }
    }
    void loadSavedMatches();
    return () => controller.abort();
  }, [active, productId, savedRevision]);

  const inFlight = useRef(new Set<string>());
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveState>>({});

  async function saveAccount(accountId: string, token?: string) {
    if (!token || inFlight.current.has(accountId)) return;
    inFlight.current.add(accountId);
    setSaveStatus((current) => ({ ...current, [accountId]: { state: "saving" } }));
    try {
      const response = await fetch("/api/graph", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error : "The account could not be saved. Try again.";
        throw new Error(message);
      }
      setSaveStatus((current) => ({ ...current, [accountId]: { state: "saved" } }));
      setSavedRevision((current) => current + 1);
    } catch (error) {
      setSaveStatus((current) => ({ ...current, [accountId]: {
        state: "error", message: error instanceof Error ? error.message : "The account could not be saved.",
      } }));
    } finally {
      inFlight.current.delete(accountId);
    }
  }

  async function findAccounts() {
    if (!request || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/discovery/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error : "Account discovery could not complete. Try again.";
        throw new Error(message);
      }
      setResult(DiscoveryResultSchema.parse(payload));
      setSelected(null);
    } catch (error) {
      setError(error instanceof Error && error.name !== "ZodError"
        ? error.message : "Account discovery returned unreadable results. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={demoPageClass}>
      <DemoPageHeader title="Account discovery"
        description={request ? `Search for companies that match the approved ICP for ${request.productName}.`
          : "Approve a customer profile to search for accounts and revisit saved matches here."}
        action={<button ref={searchButtonRef} type="button" onClick={findAccounts} disabled={!request || loading}
          className={primaryClass}>{loading ? "Finding accounts…" : "Find accounts"}</button>} />
      {!request && (
        <div className="mt-5 rounded-xl border border-[#e5eaf2] bg-white p-5 text-sm">
          <p>Generate and approve a current ICP with targeting criteria to find accounts.</p>
          <a href="#icp-review" onClick={onReview} className="mt-2 inline-block font-semibold text-[#31569e] underline">Go to ICP review</a>
        </div>
      )}
      <section aria-labelledby="new-search-results" className="space-y-4 border-t border-[#e5eaf2] pt-5">
        <h2 id="new-search-results" className="text-lg font-bold text-[#172b49]">New search results</h2>
        {loading && <p role="status" className="text-sm text-[#66748b]">Searching for new accounts…</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-800">{error}</p>}
        {!loading && !error && result?.warning && <p role="status" className="text-sm text-amber-900">{result.warning}</p>}
        {!loading && !error && !result && request && <p className="text-sm text-[#66748b]">Find accounts to run a fresh search for the approved ICP.</p>}
        {!loading && !error && result && !result.accounts.length && (
          <div className={`${sectionClass} text-sm`}>
            <p role="status">{savedMatches?.length || (productId && savedMatches === null && !savedError)
              ? "No new accounts matched this search. Your saved matches are below."
              : "No new accounts matched this search."}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={controlClass} onClick={findAccounts} disabled={!request}>Search more</button>
              <a href="#icp-review" onClick={onReview} className="font-semibold text-[#31569e] underline">Review the target role or add a concrete buying trigger</a>
            </div>
          </div>
        )}
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          {result?.accounts.map((account) => {
            const accountId = account.domain ?? JSON.stringify([account.company, account.url]);
            const save = saveStatus[accountId];
            const alreadySaved = save?.state === "saved" || (account.domain && savedDomains.has(accountDomain(account.domain)));
            return (
              <article key={accountId} className="min-w-0 space-y-3 rounded-xl border border-[#e5eaf2] bg-white p-4 text-sm leading-6 [overflow-wrap:anywhere] sm:p-5">
                <h3 className="text-lg font-bold">{account.company}</h3>
                <p><strong>Why it fits</strong> <span className="rounded bg-[#edf2ff] px-1.5 py-0.5 text-xs text-[#31569e]">Inference</span><br />{account.inference}</p>
                {(selected !== accountId || !account.observations?.length) && (
                  <div className="space-y-2 rounded-lg bg-[#f5f9fe] p-3"><p>{account.observation}</p><SourceEvidence {...account} /></div>
                )}
                <AccountBuyers company={account.company} domain={account.domain} roles={request?.buyerRoles ?? []}
                    scope={request?.productId && request.profileId ? { productId: request.productId, profileId: request.profileId, approvedAt: request.approvedAt } : undefined} />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <button type="button" aria-expanded={selected === accountId} onClick={() => setSelected(selected === accountId ? null : accountId)}
                    className="font-semibold text-[#31569e] underline">{selected === accountId ? "Hide account details" : "Show account details"}</button>
                  {alreadySaved ? (
                    <span role="status" className="font-semibold text-[#378564]">Saved</span>
                  ) : account.graphToken && (
                    <button type="button" disabled={save?.state === "saving"}
                      onClick={() => saveAccount(accountId, account.graphToken)}
                      className="rounded-lg bg-[#edf2ff] px-3 py-1.5 font-semibold text-[#31569e] disabled:opacity-50">
                      {save?.state === "saving" ? "Saving…" : "Save to graph"}
                    </button>
                  )}
                </div>
                {!alreadySaved && save?.state === "error" && <p role="alert" className="text-red-800">{save.message}</p>}
                {selected === accountId && (
                  <div className="space-y-3">
                    {IcpCategories.map((category) => {
                      const observations = account.observations?.filter((item) => item.category === category) ?? [];
                      return (
                        <section key={category} className="space-y-2 rounded-lg bg-[#f7f9fd] p-3">
                          <h4 className="font-semibold">{category}</h4>
                          {observations.length ? observations.map((observation, index) => (
                            <div key={index} className="space-y-1">
                              <p>{observation.observation}</p>
                              <SourceEvidence {...observation} />
                            </div>
                          )) : <p className="text-xs text-[#66748b]">Unknown</p>}
                        </section>
                      );
                    })}
                  </div>
                )}
                {account.graphToken && <BandReview key={account.graphToken} source={{ kind: "fresh", graphToken: account.graphToken }} />}
              </article>
            );
          })}
        </div>
        {!!result?.exclusions.length && (
          <details className="mt-5 rounded-xl border border-[#e5eaf2] bg-white p-5 text-sm">
            <summary className="cursor-pointer font-semibold">Excluded accounts ({result.exclusions.length})</summary>
            {result.exclusions.map((item, index) => (
              <div key={index} className="mt-4 space-y-1 border-t border-[#e5eaf2] pt-3">
                <p><strong>{item.company}</strong> · {item.criterion}</p>
                <p>{item.observation}</p>
                <SourceEvidence {...item} />
              </div>
            ))}
          </details>
        )}
      </section>

      <section aria-labelledby="saved-matches" className="space-y-4 border-t border-[#e5eaf2] pt-5">
        <h2 id="saved-matches" className="text-lg font-bold text-[#172b49]">Saved matches</h2>
        {savedError && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-white p-4 text-sm text-red-800">
          <p>{savedError}</p>
          <button type="button" className={controlClass} onClick={() => {
            setSavedError("");
            setSavedRevision((current) => current + 1);
          }}>Retry saved matches</button>
        </div>}
        {productId && savedMatches === null && !savedError && <p role="status" className="text-sm text-[#66748b]">Loading saved matches…</p>}
        {(!productId || savedMatches?.length === 0) && <p className="text-sm text-[#66748b]">No matches are saved for this product yet.</p>}
        <div className="grid gap-4 xl:grid-cols-2">
          {savedMatches?.map((match) => {
            const source = match.evidence[0];
            const current = match.profileId === request?.profileId && match.approvedAt === request?.approvedAt;
            const approvalLabel = request && !current
              ? Date.parse(match.approvedAt) < Date.parse(request.approvedAt) ? " · Earlier approval" : " · Different approval"
              : "";
            return <article key={match.id} className={`${sectionClass} min-w-0 text-sm [overflow-wrap:anywhere]`}>
              <h3 className="text-lg font-bold">{match.company}</h3>
              <p className="text-xs text-[#66748b]">
                ICP version <code title={match.versionId}>{match.versionId.slice(0, 12)}</code> · Approved{" "}
                <time dateTime={match.approvedAt}>{new Date(match.approvedAt).toLocaleString()}</time>
                {approvalLabel}
              </p>
              <p className="rounded-lg bg-[#f0f6fd] p-3 leading-6"><strong>Fit inference</strong> · {match.inference}</p>
              <details>
                <summary className="cursor-pointer font-semibold text-[#31569e]">Saved source evidence</summary>
                {match.evidence.map((item) => <div key={item.id} className="mt-3 space-y-1">
                  <p>{item.observation}</p><SourceEvidence {...item} />
                </div>)}
              </details>
              {source && <BandReview source={{ kind: "saved", productId, matchId: match.id, observationId: source.id }} />}
            </article>;
          })}
        </div>
      </section>
    </section>
  );
}

