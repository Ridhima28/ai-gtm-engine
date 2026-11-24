"use client";

import { useState } from "react";
import type { z } from "zod";
import { OutreachContact, ProspectRequest, ProspectsResponse } from "@/app/lib/outreach-schema";
import { SourceEvidence } from "./source-evidence";
import { controlClass, primaryClass } from "./workspace-styles";

async function prospectRequest<T>(input: z.input<typeof ProspectRequest>, schema: z.ZodType<T>) {
  const response = await fetch("/api/outreach/prospects", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "LinkedIn prospect discovery could not complete.");
  return schema.parse(payload);
}

export function LinkedInProspects({ productId, matchId, company, targetRoles, onDraft }: {
  productId: string; matchId: string; company: string; targetRoles: string[];
  onDraft: (contact: z.infer<typeof OutreachContact>) => Promise<void>;
}) {
  const [role, setRole] = useState("");
  const [result, setResult] = useState<z.infer<typeof ProspectsResponse>>();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const scope = { productId, matchId };
  const targetRole = targetRoles.includes(role) ? role : targetRoles[0];
  const search = new URL("https://www.linkedin.com/search/results/people/");
  search.searchParams.set("keywords", [company, targetRole].filter(Boolean).join(" "));

  async function find() {
    setPending("search");
    setResult(undefined);
    setError("");
    try {
      setResult(await prospectRequest({ ...scope, action: "search" }, ProspectsResponse));
    } catch (error) {
      setError(error instanceof Error ? error.message : "LinkedIn prospects could not be loaded.");
    } finally {
      setPending("");
    }
  }

  async function save(proof: string) {
    setPending(proof);
    setError("");
    try {
      const contact = await prospectRequest({ ...scope, action: "save", proof }, OutreachContact);
      await onDraft(contact);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save this contact.");
    } finally {
      setPending("");
    }
  }

  return <section aria-label="LinkedIn prospect discovery" className="space-y-3 border-y border-[#e5eaf2] py-4 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={primaryClass} disabled={Boolean(pending) || !targetRoles.length} onClick={find}>
        {pending === "search" ? "Finding LinkedIn prospects…" : "Find LinkedIn prospects"}
      </button>
      {targetRoles.length > 0 && <label>Target role <select className={controlClass} value={targetRole} onChange={(event) => setRole(event.target.value)}>
        {targetRoles.map((title) => <option key={title}>{title}</option>)}
      </select></label>}
      <a className={controlClass} href={search.href} target="_blank" rel="noreferrer">Search on LinkedIn</a>
    </div>
    {targetRoles.length === 0 && <p className="text-[#66748b]">The approved ICP used for this match has no buyer roles. You can search for the company or add a contact with a public role source.</p>}
    {pending === "search" && <p role="status">Checking public sources for current roles at {company}.</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {result?.warning && <p role="status" className="text-amber-900">{result.warning}</p>}
    {result && !result.people.length && <p role="status">No named prospects could be verified at {company}. Search on LinkedIn or add a contact with a public role source.</p>}
    {result && result.suggestedTitles.length > 0 && <p className="text-[#66748b]">
      <strong>Suggested roles · hypotheses</strong> {result.suggestedTitles.join(", ")}
    </p>}
    {result && result.people.length > 0 && <ul className="space-y-3">
      {result.people.map((person) => <li key={person.name} className="space-y-2 rounded-lg border border-[#e5eaf2] p-3">
        <p><strong>{person.name}</strong> · {person.role} · {company}</p>
        <p className="text-xs text-[#66748b]">Target-role match · inference: {person.targetRole}</p>
        <SourceEvidence {...person} />
        <div className="flex flex-wrap gap-2">
          {person.profileUrl && <a className={controlClass} href={person.profileUrl} target="_blank" rel="noreferrer">Open sourced LinkedIn profile</a>}
          <button type="button" className={controlClass} disabled={Boolean(pending)} onClick={() => save(person.proof)}>
            {pending === person.proof ? "Saving…" : "Save contact and draft"}
          </button>
        </div>
      </li>)}
    </ul>}
  </section>;
}
