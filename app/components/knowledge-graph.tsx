"use client";

import { useEffect, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { GraphCanvas, graphNodeButtonClass, graphNodeStyle, productNodeStyle } from "./graph-canvas";
import type { z } from "zod";
import { GraphResponse } from "@/app/lib/graph-schema";
import { ContactEnrichment } from "./account-outreach";
import { SourceEvidence } from "./source-evidence";

type Graph = z.infer<typeof GraphResponse>;

export function KnowledgeGraph({ productId, productName, onOutreach }: { productId: string; productName: string; onOutreach: (matchId: string) => void }) {
  const [result, setResult] = useState<Graph | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>();
  const [revision, setRevision] = useState(0);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{ message: string; failed?: boolean }>();

  async function refreshSignals() {
    setRefreshing(true);
    setRefreshResult(undefined);
    try {
      const response = await fetch("/api/graph/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setRefreshResult({ message: `${payload.checked} sources checked · ${payload.updated} updated · ${payload.unavailable} unavailable · ${payload.unconfirmed} changes unconfirmed` });
      setRevision((value) => value + 1);
    } catch (error) {
      setRefreshResult({ failed: true, message: error instanceof Error ? error.message : "Signals could not be refreshed." });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!productName) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/graph?productId=${encodeURIComponent(productId)}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (!controller.signal.aborted) setResult(GraphResponse.parse(payload));
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error && error.name !== "ZodError"
          ? error.message : "The graph returned unreadable data.");
      }
    }
    void load();
    return () => controller.abort();
  }, [productId, productName, revision]);

  const matches = result?.matches ?? [];
  const match = matches.find(({ id }) => id === selected);
  const nodes: Node[] = [{
    id: "product", type: "input", position: { x: Math.max(0, (matches.length - 1) * 125), y: 0 },
    data: { label: productName }, style: productNodeStyle,
  }];
  const edges: Edge[] = [];
  matches.forEach((item, column) => {
    const x = column * 250;
    nodes.push({
      id: item.id, type: "output", position: { x, y: 100 },
      data: { label: <button type="button" className={graphNodeButtonClass} onClick={() => setSelected(item.id)}>{item.company}</button> },
      style: graphNodeStyle,
    });
    edges.push({ id: `product-${item.id}`, source: "product", target: item.id, label: "ICP match" });
  });

  return (
    <section className="mx-auto max-w-[1390px] px-5 pb-12 pt-8 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">Knowledge graph</h1>
        {productName && (
          <div className="flex gap-2"><button type="button" onClick={refreshSignals} disabled={refreshing || !result?.matches.length}
            className="rounded-lg bg-[#31569e] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{refreshing ? "Refreshing signals…" : "Refresh signals"}</button>
          <button type="button" onClick={() => { setResult(null); setError(""); setSelected(undefined); setRevision((value) => value + 1); }}
            className="rounded-lg border border-[#dce4f4] bg-white px-3 py-2 text-sm font-semibold text-[#31569e]">Refresh graph</button></div>
        )}
      </div>
      {refreshResult && <p className="mt-4 text-sm" role={refreshResult.failed ? "alert" : "status"}>{refreshResult.message}</p>}
      {!productName && <p className="mt-4 text-sm">Resume a draft or enter a product name to open its graph.</p>}
      {productName && !result && !error && <p className="mt-4 text-sm" role="status">Loading from Neo4j…</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
      {result && (
        <>
          {!matches.length && <p className="mt-4 text-sm">No account matches saved for this product.</p>}
          <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(270px,0.42fr)]">
            <GraphCanvas nodes={nodes} edges={edges} label="Product knowledge graph" />
            {match && (
              <aside aria-label="Graph match details" className="space-y-3 rounded-xl border border-[#e5eaf2] bg-white p-5 text-sm">
                <div className="flex justify-between gap-2">
                  <h2 className="text-lg font-bold">{match.company}</h2>
                  <button type="button" onClick={() => setSelected(undefined)} className="text-[#31569e] underline">Close</button>
                </div>
                <p className="text-xs text-[#66748b]">{match.productName} · ICP approved <time dateTime={match.approvedAt}>{new Date(match.approvedAt).toLocaleString()}</time></p>
                <p><strong>Match inference</strong><br />{match.inference}</p>
                <section className="space-y-2 border-t border-[#e5eaf2] pt-3">
                  <h3 className="font-semibold">Verified buyers</h3>
                  {!match.buyers.length && <p>No sourced current buyer role has been saved for this company.</p>}
                  {match.buyers.map((buyer) => (
                    <div key={buyer.id} className="space-y-1">
                      <p><strong>{buyer.name}</strong> · {buyer.role}</p>
                      <SourceEvidence {...buyer} />
                      {match.domain && <ContactEnrichment scope={{ productId, matchId: match.id }} buyer={buyer} />}
                    </div>
                  ))}
                  <h3 className="font-semibold">Warm introductions</h3>
                  <p>No sourced employment overlap is available.</p>
                </section>
                <p className="text-xs text-[#66748b]">Source observations describe the reported facts. Hiring and tool requirements do not establish buying intent.</p>
                {match.evidence.map((evidence) => (
                  <section key={evidence.id} className="space-y-2 border-t border-[#e5eaf2] pt-3">
                    <h3 className="font-semibold">Sourced observation · {evidence.category}</h3>
                    <p>{evidence.observation}</p>
                    <SourceEvidence {...evidence} />
                    {match.checks.filter(({ url }) => url === evidence.url).map((check) => (
                      <p key={check.url} className="text-xs text-[#66748b]">
                        Checked <time dateTime={check.checkedAt}>{new Date(check.checkedAt).toLocaleString()}</time> · {check.status}
                      </p>
                    ))}
                  </section>
                ))}
                <button type="button" className="rounded-lg bg-[#31569e] px-4 py-2.5 text-sm font-semibold text-white" onClick={() => onOutreach(match.id)}>Draft email from evidence</button>
              </aside>
            )}
          </div>
          {!!result.segments.length && (
            <section className="mt-4 rounded-xl border border-[#e5eaf2] bg-white p-5 text-sm">
              <h2 className="font-bold">Accepted adjacent segments</h2>
              {result.segments.map((segment) => (
                <div key={JSON.stringify([segment.capability, segment.painPoint, segment.naics, segment.segment])} className="mt-3 space-y-1 border-t border-[#e5eaf2] pt-3">
                  <p><strong>{segment.segment}</strong> · NAICS {segment.naics}</p>
                  <p>{segment.painPoint}</p>
                  <p>Product-fit hypothesis · {segment.rationale}</p>
                  {segment.sources.map((url, index) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="mr-3 text-[#31569e] underline">Original source {index + 1}</a>
                  ))}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </section>
  );
}
