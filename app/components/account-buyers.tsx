"use client";

import { useState } from "react";
import { BuyerRequestSchema, BuyerResultSchema } from "@/app/lib/research-schema";
import { SourceEvidence } from "./source-evidence";
import type { z } from "zod";

export function AccountBuyers({ company, domain, roles, scope }: { company: string; domain?: string; roles: string[]; scope?: z.input<typeof BuyerRequestSchema>["scope"] }) {
  const [result, setResult] = useState<z.infer<typeof BuyerResultSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = BuyerRequestSchema.safeParse({ company, domain, roles, scope });
  const suggestedTitles = error ? [...new Set(roles)].slice(0, 5) : result?.suggestedTitles ?? [];

  async function findBuyers() {
    if (!request.success || busy) return;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const response = await fetch("/api/discovery/buyers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setResult(BuyerResultSchema.parse(payload));
    } catch (error) {
      setError(error instanceof Error && error.name !== "ZodError" ? error.message : "Buyer research returned unreadable results.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={`Buyers at ${company}`} className="mt-4 space-y-3 border-t border-[#e5eaf2] pt-3">
      <button type="button" onClick={findBuyers} disabled={busy || !request.success}
        className="rounded-lg bg-[#edf2ff] px-3 py-1.5 font-semibold text-[#31569e] disabled:opacity-50">
        {busy ? "Finding buyers…" : "Find buyers"}
      </button>
      {!roles.length && <p>Add buyer roles in ICP Review and reapprove to research named buyers.</p>}
      {!!roles.length && !request.success && <p>Research this account again to establish its company domain.</p>}
      {result?.graphWarning && <p role="alert" className="text-sm text-red-800">Research completed, but graph saving failed. {result.graphWarning}</p>}
      {error && <p role="alert" className="text-red-800">{error}</p>}
      {result?.warning && <p role="status" className="text-amber-900">{result.warning}</p>}
      {result && !result.people.length && <p role="status">{result.warning ? "No matching named buyers in the available sources." : "No named buyers had evidence of a current matching role."} Check the company’s leadership pages for the suggested roles, or add a sourced contact in Outreach.</p>}
      {result?.people.map((person) => (
        <div key={person.name} className="space-y-1 rounded-lg border border-[#e5eaf2] p-3">
          <p><strong>{person.name}</strong> · {person.role}</p>
          <p className="text-xs text-[#66748b]">Role-match inference · {person.targetRole}</p>
          <SourceEvidence {...person} />
        </div>
      ))}
      {!!suggestedTitles.length && (
        <div>
          <strong>Suggested titles · Hypotheses</strong>
          <ul className="list-inside list-disc">{suggestedTitles.map((title) => <li key={title}>{title}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
