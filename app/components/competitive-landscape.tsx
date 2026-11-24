"use client";

import { useState } from "react";
import { CompetitionRequestSchema, CompetitionResultSchema, CompetitorTypes, type CompetitionRequest } from "@/app/lib/research-schema";
import { SourceEvidence } from "./source-evidence";
import type { z } from "zod";
import { Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { GraphCanvas, graphNodeButtonClass, graphNodeStyle, productNodeStyle } from "./graph-canvas";
import { controlClass, headingClass, primaryClass, sectionClass, workspaceClass } from "./workspace-styles";

type Result = z.infer<typeof CompetitionResultSchema>;
type Category = typeof CompetitorTypes[number];
const groups = {
  Direct: { title: "Direct competitors", x: -285, y: 0, position: Position.Left, incoming: Position.Right },
  Indirect: { title: "Indirect competitors", x: 285, y: 0, position: Position.Right, incoming: Position.Left },
  Alternative: { title: "Alternatives", x: 0, y: 130, position: Position.Bottom, incoming: Position.Top },
};

function FounderNode({ data }: NodeProps<Node<{ label: string }>>) {
  return <div style={productNodeStyle} className="rounded-lg border border-[#254889] p-3 text-center text-sm">
    {data.label}
    {CompetitorTypes.map((category) => <Handle key={category} id={category} type="source" position={groups[category].position} />)}
  </div>;
}

const nodeTypes = { founder: FounderNode };

export function CompetitiveLandscape({ product, onIntake }: { product: CompetitionRequest; onIntake: () => void }) {
  const [result, setResult] = useState<Result | null>(null);
  const [expanded, setExpanded] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = CompetitionRequestSchema.safeParse(product);
  const selection = result?.competitors.find(({ id }) => id === selected);
  const missing = [];
  if (!product.productName.trim()) missing.push("Add a product name.");
  if (!product.description?.trim() && !product.capabilities.some((capability) => capability.trim())) {
    missing.push("Add a product description or at least one capability.");
  }
  if (!missing.length && !request.success) missing.push("Check the length of your product intake fields.");

  async function researchCompetitors() {
    if (!request.success || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setExpanded([]);
    setSelected(null);
    try {
      const response = await fetch("/api/competition/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Competitive research did not complete. Try again.");
      const validated = CompetitionResultSchema.parse(payload);
      if (validated.productId !== product.productId) throw new Error("The results were for a different product.");
      setResult(validated);
    } catch (error) {
      setError(error instanceof Error && error.name !== "ZodError" ? error.message : "Competitive research returned unreadable results.");
    } finally {
      setBusy(false);
    }
  }

  function toggleGroup(category: Category) {
    setExpanded((open) => open.includes(category) ? open.filter((group) => group !== category) : [...open, category]);
    if (selection?.category === category) setSelected(null);
  }

  const edges: Edge[] = [];
  const nodes: Node[] = [{
    id: "product", type: "founder", position: { x: 0, y: 0 }, data: { label: product.productName },
  }];
  for (const category of CompetitorTypes) {
    const competitors = result?.competitors.filter((item) => item.category === category) ?? [];
    const open = expanded.includes(category);
    const group = groups[category];
    const groupId = `group-${category}`;
    nodes.push({
      id: groupId, position: { x: group.x, y: group.y }, sourcePosition: group.position, targetPosition: group.incoming,
      data: { label: <button type="button" className={graphNodeButtonClass} aria-expanded={open}
        onClick={() => toggleGroup(category)}>{group.title} <span>({competitors.length})</span></button> },
      style: graphNodeStyle,
    });
    edges.push({ id: `product-${groupId}`, source: "product", sourceHandle: category, target: groupId });
    if (open) competitors.forEach((item, column) => {
      const nodeId = `competitor-${item.id}`;
      const distance = column - (competitors.length - 1) / 2;
      const position = category === "Alternative"
        ? { x: distance * 230, y: 255 }
        : { x: group.x * 2, y: distance * 95 };
      nodes.push({
        id: nodeId, type: "output", position, targetPosition: group.incoming,
        data: { label: <button type="button" className={graphNodeButtonClass} aria-pressed={selected === item.id}
          onClick={() => setSelected(item.id)}>{item.name}</button> },
        style: { ...graphNodeStyle, background: selected === item.id ? "#dbe7ff" : "white" },
      });
      edges.push({ id: `${groupId}-${nodeId}`, source: groupId, target: nodeId });
    });
  }

  return (
    <section className={workspaceClass}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={headingClass}>Competitive landscape</h1>
          {product.productName.trim() && <p className="mt-2 text-sm text-[#66748b]">Compare alternatives to {product.productName.trim()}.</p>}
        </div>
        <button type="button" className={primaryClass} onClick={researchCompetitors} disabled={!request.success || busy}>
          {busy ? "Researching competitors…" : "Research competitors"}
        </button>
      </header>
      {!request.success && (
        <div className={sectionClass}>
          <p>{missing.join(" ")}</p>
          <a className="text-sm text-[#31569e] underline" href="#product-intake" onClick={onIntake}>Go to Product intake</a>
        </div>
      )}
      {busy && <p role="status" className={sectionClass}>Searching vendor sites and verifying public claims.</p>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {result?.graphWarning && <p role="alert" className="text-sm text-red-800">Research completed, but graph saving failed. {result.graphWarning}</p>}
      {result?.warning && <p role="status" className="text-sm text-amber-900">{result.warning}</p>}
      {result && !result.competitors.length && <p role="status" className={sectionClass}>{result.warning
        ? "The available sources did not verify a competitor." : "No competitors had enough official evidence for a comparison."}
        {" "}<a href="#product-intake" onClick={onIntake} className="text-[#31569e] underline">Add a specific capability in Product intake</a> and try again.</p>}
      {!!result?.competitors.length && (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(270px,0.55fr)]">
          <div className="min-w-0 space-y-2">
            <GraphCanvas nodes={nodes} edges={edges} nodeTypes={nodeTypes} label="Competitive landscape map" layoutKey={`${expanded.join(",")}:${Boolean(selection)}`} />
            {expanded.some((category) => !result.competitors.some((item) => item.category === category)) &&
              <p role="status" className="text-sm text-[#66748b]">No sourced competitors in the expanded empty groups.</p>}
          </div>
          {selection && <aside aria-label="Competitor details" className={`${sectionClass} min-w-0 text-sm break-words`}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold">{selection.name}</h2>
              <button type="button" className={controlClass} onClick={() => setSelected(null)}>Close</button>
            </div>
            {[
              { label: "Positioning", claims: selection.claims.filter((claim) => claim.kind !== "Pricing or packaging") },
              { label: "Pricing & packaging", claims: selection.claims.filter((claim) => claim.kind === "Pricing or packaging") },
            ].map(({ label, claims }) => <section key={label} className="space-y-2 border-t border-[#e5eaf2] pt-3">
              <h3 className="font-semibold">{label}</h3>
              {claims.length ? claims.map((claim, index) => <div key={index} className="space-y-1">
                <p>{claim.observation}</p><SourceEvidence {...claim} />
              </div>) : <p>{label === "Positioning" ? "No sourced positioning claim available." : "No public pricing or packaging verified."}</p>}
            </section>)}
            <section className="space-y-2 border-t border-[#e5eaf2] pt-3">
              <h3 className="font-semibold">How it compares</h3>
              <p><strong>Classification inference · {groups[selection.category].title}</strong><br />{selection.classificationInference}</p>
              {selection.differenceInference && <p><strong>Comparison inference</strong><br />{selection.differenceInference}</p>}
            </section>
          </aside>}
        </div>
      )}
    </section>
  );
}
