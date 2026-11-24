"use client";

import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { GraphResponse } from "@/app/lib/graph-schema";
import { PipelineResponse, PipelineStages, StageEvent, type PipelineStage } from "@/app/lib/pipeline-schema";
import { OutreachTimeline, readWorkspace } from "./outreach-workspace";
import { SourceEvidence } from "./source-evidence";
import { DemoPageHeader, demoPageClass } from "./demo-page";
import { controlClass, primaryClass, sectionClass } from "./workspace-styles";

type Graph = z.infer<typeof GraphResponse>;
type Pipeline = z.infer<typeof PipelineResponse>;
type Stage = z.infer<typeof PipelineStage>;
const progressStages = PipelineStages.filter((stage) => stage !== "Lost");

function StageControls({ stage, busy, onSubmit }: { stage: Stage; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [next, setNext] = useState<Stage>(stage);
  return <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
    <label>New stage <select name="stage" value={next} className={controlClass}
      onChange={(event) => setNext(event.target.value as Stage)} disabled={busy}>
      {PipelineStages.map((stage) => <option key={stage}>{stage}</option>)}
    </select></label>
    <label>Changed by <input name="actor" className={controlClass} required maxLength={100} disabled={busy} /></label>
    <button className={primaryClass} type="submit" disabled={busy || next === stage}>{busy ? "Saving…" : "Save stage change"}</button>
  </form>;
}

export function PipelineWorkspace({ productId, onIntake, onDiscovery }: { productId: string; onIntake: () => void; onDiscovery: () => void }) {
  const [data, setData] = useState<{ graph: Graph; pipeline: Pipeline }>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({ productId });

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ productId });
    Promise.all([
      readWorkspace(`/api/graph?${query}`, GraphResponse, controller.signal),
      readWorkspace(`/api/pipeline?${query}`, PipelineResponse, controller.signal),
    ]).then(([graph, pipeline]) => setData({ graph, pipeline }))
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [productId]);

  const rows = data?.graph.matches.map((match) => ({
    ...match, ...(data.pipeline.leads.find(({ id }) => id === match.id) ?? { stage: "Matched" as const, changes: [] }),
  })) ?? [];
  const lead = rows.find(({ id }) => id === selected);
  const counts = PipelineStages.map((stage) => ({ stage, total: rows.filter((row) => row.stage === stage).length }));
  const reached = progressStages.map((stage, index) => rows.filter((row) =>
    [row.stage, ...row.changes.map((change) => change.stage)].some((value) =>
      value !== "Lost" && progressStages.indexOf(value) >= index)).length);

  async function updateStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lead) return;
    const { stage, actor } = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/pipeline?${query}`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, matchId: lead.id, previous: lead.stage, stage, actor }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      const change = StageEvent.parse(payload);
      setData((prior) => prior && ({ ...prior, pipeline: { ...prior.pipeline, leads: [
        ...prior.pipeline.leads.filter(({ id }) => id !== lead.id),
        { id: lead.id, stage: change.stage, changes: [change, ...lead.changes] },
      ] } }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Stage change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={demoPageClass}>
    <DemoPageHeader title="Pipeline" description="Track saved accounts, review their evidence, and update lead stages."
      action={data && (rows.length
        ? <a href="#pipeline-matches" className={primaryClass}>View saved matches</a>
        : <button type="button" className={primaryClass} onClick={onDiscovery}>Open Account discovery</button>)} />
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading Aura matches…</p>}
    {data && (<>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {counts.map(({ stage, total }) => <div key={stage} className={`${sectionClass} flex min-h-25 min-w-0 flex-col justify-between gap-1 border-t-2 border-t-[#8fb7ed]`}><h2 className="text-xs font-semibold text-[#52627d] sm:text-sm">{stage}</h2><p className="text-3xl font-bold tabular-nums tracking-tight text-[#243148]">{total}</p></div>)}
      </div>
      <section className={sectionClass}>
        <h2 className="font-semibold">Conversion metrics</h2>
        <p className="text-sm text-[#66748b]">Cumulative progression per saved match. Later stages count toward earlier milestones. Demo activity is excluded.</p>
        <ul className="flex flex-wrap gap-4 text-sm">
          {progressStages.slice(1).map((stage, index) => <li key={stage}>{progressStages[index]} → {stage}{" "}
            <strong>{reached[index] ? `${Math.round(reached[index + 1] / reached[index] * 100)}% (${reached[index + 1]}/${reached[index]})` : "—"}</strong>
          </li>)}
        </ul>
      </section>
      <section id="pipeline-matches" className={`${sectionClass} scroll-mt-4`}>
        <h2 className="text-lg font-bold text-[#172b49]">Saved matches</h2>
        {!rows.length ? <p className="text-sm">No saved matches for this product. <button className="underline" onClick={onIntake}>Open Product intake</button></p> :
          <ul className="space-y-2">{rows.map((row) => <li key={row.id} className="min-w-0 rounded-lg border border-[#e5eaf2]">
            <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-3 text-left text-sm hover:bg-[#f4f7fd] aria-expanded:bg-[#edf2ff] focus-visible:outline-2 focus-visible:outline-[#31569e]"
              aria-expanded={selected === row.id} onClick={() => setSelected(selected === row.id ? "" : row.id)}>
              <span className="min-w-0 font-semibold text-[#31569e] [overflow-wrap:anywhere]">{row.company}</span><span className="flex items-center gap-3"><span className="rounded-full bg-[#e9f2ff] px-2.5 py-1 text-xs font-semibold text-[#21477e]">{row.stage}</span><span aria-hidden="true">{selected === row.id ? "−" : "+"}</span></span>
            </button>
            {lead?.id === row.id && <div className="space-y-4 p-3">
              <StageControls key={row.stage} stage={row.stage} busy={busy} onSubmit={updateStage} />
              <section className={sectionClass}><h3 className="font-semibold">Stage history</h3>
                {row.changes.length ? <ul>{row.changes.map((change) => <li key={change.id} className="text-sm">
                  {change.previous} → {change.stage} · {change.actor} · <time dateTime={change.at}>{new Date(change.at).toLocaleString()}</time>
                </li>)}</ul> : <p className="text-sm">No stage changes yet.</p>}
              </section>
              <section className={sectionClass}><h3 className="font-semibold">Match evidence</h3>
                <p className="text-sm">Fit inference · {row.inference}</p>
                {row.evidence.map((item) => <div key={item.id} className="space-y-1 text-sm"><strong>{item.category}</strong><p>{item.observation}</p><SourceEvidence {...item} /></div>)}
              </section>
              <section className={sectionClass}><h3 className="font-semibold">Outreach timeline</h3>
                <OutreachTimeline events={data.pipeline.outreach.filter(({ matchId }) => matchId === row.id)} />
              </section>
            </div>}
          </li>)}</ul>}
      </section>
    </>)}
  </section>;
}
