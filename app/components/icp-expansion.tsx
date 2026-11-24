"use client";

import { useEffect, useState, type Ref } from "react";
import { z } from "zod";
import { AdjacentCandidate, AdjacentIdea, ExpansionResults, type Hypothesis } from "@/app/lib/expansion-schema";
import type { ProductIntake } from "@/app/types/product";

const Dismissals = z.array(z.object({ segment: z.string(), reason: z.string() })).max(25);


export function IcpExpansion({ intake, industries, disabled, onBusy, onAccept, researchButtonRef }: {
  intake: ProductIntake;
  industries: string[];
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onAccept: (hypothesis: Hypothesis) => void;
  researchButtonRef?: Ref<HTMLButtonElement>;
}) {
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [ideas, setIdeas] = useState<z.infer<typeof AdjacentIdea>[]>([]);
  const [searched, setSearched] = useState(false);
  const [warning, setWarning] = useState("");
  const [dismissals, setDismissals] = useState<z.infer<typeof Dismissals>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [segment, setSegment] = useState("");
  const [targetHeadcount, setTargetHeadcount] = useState("");
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const key = `atlas-expansion-dismissals-${intake.id}`;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = Dismissals.safeParse(JSON.parse(localStorage.getItem(key) ?? "[]"));
        if (saved.success) setDismissals(saved.data);
      } catch {
        setError("Prior dismissal reasons could not be loaded.");
      }
    });
    return () => { active = false; };
  }, [key]);

  async function research(focus?: z.infer<typeof AdjacentCandidate>) {
    if (disabled) return;
    setError("");
    setWarning("");
    setSearched(false);
    setStatus(focus ? `Researching ${focus.segment}…` : "Researching adjacent markets…");
    onBusy(true);
    try {
      const response = await fetch("/api/icp/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake, industries, dismissals, focus }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const next = ExpansionResults.parse(result);
      setHypotheses((current) => focus
        ? [...current.filter(({ segment }) => segment !== focus.segment), ...next.hypotheses] : next.hypotheses);
      setIdeas((current) => focus
        ? [...current.filter(({ candidate }) => candidate.segment !== focus.segment), ...next.ideas] : next.ideas);
      setWarning(next.warning ?? "");
      setSearched(true);
      setEditing(null);
      setDismissing(null);
      setStatus("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Research failed.");
      setStatus("");
    } finally {
      onBusy(false);
    }
  }

  async function accept(hypothesis: Hypothesis) {
    setError("");
    onBusy(true);
    try {
      const response = await fetch("/api/icp/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: intake.id, hypothesis }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onAccept(hypothesis);
      setHypotheses((current) => current.filter((item) => item !== hypothesis));
      setStatus(result.graphSaved ? "Added to the ICP and saved to Neo4j." : "Added to the ICP.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not accept the segment.");
    } finally {
      onBusy(false);
    }
  }

  function dismiss(hypothesis: Hypothesis) {
    const next = [...dismissals, { segment: hypothesis.segment, reason: reason.trim() }].slice(-25);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setDismissals(next);
      setHypotheses((current) => current.filter((item) => item !== hypothesis));
      setDismissing(null);
      setError("");
      setStatus("Dismissal reason saved.");
    } catch {
      setError("Could not save the dismissal reason in this browser.");
    }
  }

  return (
    <section id="adjacent-markets" aria-label="Adjacent Markets" className="mt-5 scroll-mt-4 rounded-xl border border-[#e5eaf2] bg-white p-5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold">Adjacent Markets</h2>
        <button ref={researchButtonRef} type="button" onClick={() => research()} disabled={disabled} className="rounded-lg bg-[#31569e] px-4 py-2 font-semibold text-white disabled:opacity-50">
          Research adjacent markets
        </button>
      </div>
      {status && <p role="status" className="mt-3">{status}</p>}
      {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
      {warning && <p role="status" className="mt-3 text-amber-900">{warning}</p>}
      <h3 className="mt-4 text-sm font-semibold">Evidence-backed suggestions</h3>
      {searched && !hypotheses.length && <p role="status" className="mt-2 text-[#66748b]">
        {warning ? "None of the available sources verified a suggestion." : "No adjacent markets had enough evidence."}
        {" "}{ideas.length ? "Choose Research further on an idea to check a more focused set of sources." :
          "Add a specific operational problem to the product description and rerun research."}
      </p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {hypotheses.map((hypothesis) => (
          <article key={hypothesis.segment} className="mt-3 space-y-2 rounded-lg border border-[#e5eaf2] p-4 leading-5">
            <h4 className="text-sm font-bold">{hypothesis.segment}</h4>
            <p>NAICS {hypothesis.naics} · {hypothesis.painPoint}</p>
            {hypothesis.targetHeadcount && <p>Target headcount · {hypothesis.targetHeadcount}</p>}
            <p><strong>Intake capability</strong> · {hypothesis.capability}</p>
            <p><strong>Product-fit hypothesis</strong> · {hypothesis.rationale}</p>
            <p><strong>What the sources establish</strong> · Evidence for the operational pain in this industry.</p>
            <ul className="space-y-1">
              {hypothesis.evidence.map((work) => (
                <li key={work.id}><a href={work.id} target="_blank" rel="noreferrer" className="text-[#31569e] underline">{work.title}{work.year ? ` (${work.year})` : ""}</a>{work.excerpt && <blockquote className="mt-1 border-l-2 border-[#dce4f4] pl-2">{work.excerpt}</blockquote>}</li>
              ))}
            </ul>
            <p className="text-[#66748b]">Still to validate: whether this product solves the pain for buyers in this market.</p>
            <div className="flex flex-wrap gap-3 font-semibold text-[#31569e]">
              <button type="button" disabled={disabled || editing === hypothesis.segment} onClick={() => accept(hypothesis)}>Accept into ICP</button>
              <button type="button" disabled={disabled} onClick={() => { setDismissing(null); setEditing(hypothesis.segment); setSegment(hypothesis.segment); setTargetHeadcount(hypothesis.targetHeadcount ?? ""); }}>Edit parameters</button>
              <button type="button" disabled={disabled} onClick={() => { setEditing(null); setDismissing(hypothesis.segment); setReason(""); }}>Dismiss</button>
            </div>
            {editing === hypothesis.segment && (
              <div className="space-y-2">
                <label className="block">Segment label
                  <input value={segment} maxLength={180} disabled={disabled} onChange={(event) => setSegment(event.target.value)} className="ml-2 rounded border p-1" />
                </label>
                <label className="block">Target headcount
                  <input value={targetHeadcount} maxLength={100} disabled={disabled} onChange={(event) => setTargetHeadcount(event.target.value)} className="ml-2 rounded border p-1" />
                </label>
                <button type="button" disabled={disabled || !segment.trim() || hypotheses.some((item) => item !== hypothesis && item.segment.toLowerCase() === segment.trim().toLowerCase())}
                  onClick={() => { setHypotheses((current) => current.map((item) => item === hypothesis ? { ...item, segment: segment.trim(), targetHeadcount: targetHeadcount.trim() || undefined } : item)); setEditing(null); }}>Save parameters</button>
                <button type="button" className="ml-3" disabled={disabled} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            )}
            {dismissing === hypothesis.segment && (
              <div className="space-y-2">
                <label className="block">Dismissal reason
                  <input value={reason} maxLength={500} disabled={disabled} onChange={(event) => setReason(event.target.value)} className="ml-2 rounded border p-1" />
                </label>
                <button type="button" disabled={disabled || !reason.trim()} onClick={() => dismiss(hypothesis)}>Save dismissal</button>
              </div>
            )}
          </article>
        ))}
      </div>
      <h3 className="mt-5 text-sm font-semibold">Ideas to investigate</h3>
      {searched && !ideas.length && <p className="mt-2 text-[#66748b]">No unverified ideas from this search.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {ideas.map(({ candidate, missing, context }) => <article key={candidate.segment} className="mt-3 space-y-2 rounded-lg border border-[#e5eaf2] bg-[#f8faff] p-4 leading-5">
          <h4 className="text-sm font-bold">{candidate.segment}</h4>
          <p><strong>Unverified hypothesis</strong> · {candidate.painPoint}</p>
          {context ? <div>
            <p><strong>What the source establishes</strong> · Related context only</p>
            <a href={context.id} target="_blank" rel="noreferrer" className="text-[#31569e] underline">{context.title}</a>
            <blockquote className="mt-1 border-l-2 border-[#dce4f4] pl-2">{context.excerpt}</blockquote>
          </div> : <p>No directly relevant source was verified for this idea.</p>}
          <p><strong>What’s missing</strong> · {missing}</p>
          <button type="button" className="rounded-lg border border-[#dce4f4] bg-white px-3 py-2 font-semibold text-[#31569e] disabled:opacity-50"
            disabled={disabled} onClick={() => research(candidate)}>Research further</button>
        </article>)}
      </div>
    </section>
  );
}
