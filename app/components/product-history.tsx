"use client";

import { useEffect, useState } from "react";
import { OutreachOverview } from "@/app/lib/outreach-schema";
import { OutreachTimeline, readWorkspace, type HistoryItem } from "./outreach-workspace";
import { controlClass, headingClass, primaryClass, sectionClass, workspaceClass } from "./workspace-styles";

export type ProductHistoryEntry = {
  id: string;
  productId: string;
  productName: string;
  profileName: string;
  approvedAt: string | null;
  needsReapproval: boolean;
  savedAt: string;
};

export function ProductHistory({ entries, onOpen }: { entries: ProductHistoryEntry[]; onOpen: (id: string) => void }) {
  const [selected, setSelected] = useState("");
  const [testHistory, setTestHistory] = useState<{ id: string; events: HistoryItem[]; error?: string }>();
  const productId = entries.find((entry) => entry.id === selected)?.productId;
  useEffect(() => {
    if (!productId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ productId, overview: "1" });
    readWorkspace(`/api/outreach?${query}`, OutreachOverview, controller.signal)
      .then(({ events }) => setTestHistory({ id: productId, events: events.filter((event) => event.demo) }))
      .catch((error: Error) => {
        if (!controller.signal.aborted) setTestHistory({ id: productId, events: [], error: error.message });
      });
    return () => controller.abort();
  }, [productId]);

  return <section className={workspaceClass}>
    <h1 className={headingClass}>Product history</h1>
    <p className="text-sm text-[#66748b]">Product and ICP snapshots saved in this browser, with available test activity from Aura.</p>
    {!entries.length && <p>No saved products yet.</p>}
    {entries.map((entry) => <article className={sectionClass} key={entry.id}>
      <h2 className="text-base font-bold text-[#243148] [overflow-wrap:anywhere]">{entry.productName || "Untitled product"}</h2>
      <p className="text-sm">{entry.profileName} · {entry.approvedAt
        ? <>Approved <time dateTime={entry.approvedAt}>{new Date(entry.approvedAt).toLocaleString()}</time></>
        : entry.needsReapproval ? "Reapproval required" : "Needs review"}</p>
      <p className="text-sm text-[#66748b]">Saved <time dateTime={entry.savedAt}>{new Date(entry.savedAt).toLocaleString()}</time></p>
      <div className="flex flex-wrap gap-2 border-t border-[#e5eaf2] pt-3">
        <button type="button" className={primaryClass} onClick={() => onOpen(entry.id)} aria-label={`Reopen ${entry.productName || "untitled product"} and ICP`}>Reopen</button>
        <button type="button" className={controlClass} aria-expanded={selected === entry.id}
          onClick={() => setSelected((current) => current === entry.id ? "" : entry.id)}>Test history</button>
      </div>
      {selected === entry.id && <section aria-label="Product test history">
        <h3 className="font-semibold">Test activity for {entry.productName}</h3>
        {testHistory?.id !== entry.productId ? <p role="status">Loading test history…</p> :
          testHistory.error ? <p role="alert">{testHistory.error}</p> : <OutreachTimeline events={testHistory.events} />}
      </section>}
    </article>)}
  </section>;
}
