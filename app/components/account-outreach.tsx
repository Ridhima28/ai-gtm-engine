"use client";

import { useEffect, useState } from "react";
import { ContactResult, OutreachResponse } from "@/app/lib/outreach-schema";
import type { z } from "zod";
import { controlClass, primaryClass } from "./workspace-styles";

type Scope = { productId: string; matchId: string };
export type Channel = "email" | "linkedin";
type Buyer = { id: string; name: string };
export const eventLabels = {
  drafted: "Draft created", edited: "New draft version", approved: "Draft version approved",
  sandbox_validated: "Sandbox validation passed", sandbox_failed: "Sandbox validation failed",
  test_send_accepted: "Test email accepted by SendGrid", test_send_failed: "Test email rejected by SendGrid",
  test_send_unconfirmed: "Test email acceptance unconfirmed", linkedin_sent: "Marked sent manually",
};
const actionStyle = controlClass;
const fieldStyle = "block w-full rounded-lg border border-[#dce4f4] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[#31569e]";

export async function postOutreach<T>(scope: Scope, params: Record<string, string | undefined>, schema: z.ZodType<T>) {
  const response = await fetch("/api/outreach", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, ...params }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Outreach could not complete.");
  return schema.parse(payload);
}

export function ContactEnrichment({ scope, buyer }: { scope: Scope; buyer: Buyer }) {
  const [result, setResult] = useState<z.infer<typeof ContactResult>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enrich() {
    setBusy(true);
    setError("");
    try {
      setResult(await postOutreach(scope, { action: "enrich", buyerId: buyer.id }, ContactResult));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Contact enrichment failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button type="button" className={actionStyle} disabled={busy} onClick={enrich}>
        {busy ? "Enriching contact…" : "Enrich contact"}
      </button>
      {error && <p role="alert" className="text-red-800">{error}</p>}
      {result && <p role="status">{result.email ?? "No work email found"} · Hunter status: {result.status.replaceAll("_", " ")}</p>}
    </div>
  );
}

export function AccountOutreach({ productId, matchId, channel, buyerId, onActivity }: Scope & {
  channel: Channel; buyerId?: string; onActivity: () => void;
}) {
  const [draft, setDraft] = useState<z.infer<typeof OutreachResponse>["draft"]>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const dirty = draft && (draft.subject !== subject || draft.body !== body);
  const approved = draft && !dirty && draft.approvedVersionId === draft.versionId;
  const disabled = !!active || draft?.busy;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ productId, matchId, channel, ...(buyerId ? { buyerId } : {}) });
        const response = await fetch(`/api/outreach?${query}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        const { draft } = OutreachResponse.parse(payload);
        if (controller.signal.aborted) return;
        setDraft(draft);
        setSubject(draft?.subject ?? "");
        setBody(draft?.body ?? "");
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load outreach.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [productId, matchId, channel, buyerId]);

  async function run(action: "draft" | "edit" | "approve" | "sandbox" | "test_send" | "mark_sent") {
    setActive(action);
    setError("");
    setStatus("");
    try {
      const recipient = buyerId ? { buyerId } : {};
      const params = action === "draft" ? { action, channel, ...recipient } :
        { action, channel, ...recipient, versionId: draft?.versionId ?? "", ...(action === "edit" ? { subject, body } : {}) };
      const result = await postOutreach({ productId, matchId }, params, OutreachResponse);
      setDraft(result.draft);
      setSubject(result.draft?.subject ?? "");
      setBody(result.draft?.body ?? "");
      onActivity();
      if (action === "mark_sent") setStatus("LinkedIn activity recorded.");
      if (action === "sandbox") setStatus("Sandbox validation passed. No email was sent.");
      if (action === "test_send") setStatus("SendGrid accepted the email for the configured test inbox.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Outreach could not complete.");
    } finally {
      setActive("");
    }
  }

  async function copyDraft() {
    if (!approved) return;
    try {
      setError("");
      await navigator.clipboard.writeText(body);
      setStatus("Approved LinkedIn draft copied.");
    } catch {
      setError("Clipboard access failed. You can select and copy the approved text.");
    }
  }

  return (
    <section aria-label={channel === "email" ? "Email outreach" : "LinkedIn outreach"} className="space-y-4">
      <h3 className="font-semibold">{channel === "email" ? "Email draft" : "LinkedIn draft"}</h3>
      <p className="text-xs text-[#66748b]">{channel === "email"
        ? "Demo activity · Sandbox validates the request. Test email goes to the configured test inbox."
        : "Copy the approved draft and send it manually on LinkedIn."}</p>
      {loading && <p role="status">Loading draft…</p>}
      {!loading && !draft && <button type="button" className={actionStyle} disabled={!!active || (channel === "linkedin" && !buyerId)} onClick={() => run("draft")}>{active ? "Drafting…" : channel === "email" ? "Draft email from evidence" : "Draft LinkedIn message from evidence"}</button>}
      {draft && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-sm [overflow-wrap:anywhere]">Recipient: {draft.recipient}</p>
            <p role="status" className={`rounded-full px-3 py-1 text-xs font-semibold ${approved ? "bg-[#e0f3e9] text-[#21664c]" : "bg-[#fff4d6] text-[#754b13]"}`}>
              {dirty ? "Unsaved edits · reapproval required" : approved ? "Exact draft version approved" : "Draft requires approval"}
            </p>
          </div>
          {channel === "email" && <label className="block space-y-1">Subject
            <input className={fieldStyle} value={subject} maxLength={200} disabled={disabled} onChange={(event) => setSubject(event.target.value)} />
          </label>}
          <label className="block space-y-1">Body
            <textarea className={`${fieldStyle} min-h-64 resize-y leading-6`} rows={12} value={body} maxLength={12000} disabled={disabled} onChange={(event) => setBody(event.target.value)} />
          </label>
          <div role="group" aria-label="Draft approval and delivery" className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e5eaf2] bg-[#f8faff] p-3 sm:p-4">
            {dirty && <button type="button" className={actionStyle} disabled={disabled || !subject.trim() || !body.trim()} onClick={() => run("edit")}>Save edits</button>}
            <button type="button" className={`${primaryClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#31569e]`} disabled={disabled || !!dirty || !!approved}
              onClick={() => run("approve")}>{approved ? "Approved" : active === "approve" ? "Approving…" : "Approve draft version"}</button>
            {channel === "linkedin" && <>
              <button type="button" className={actionStyle} disabled={disabled || !approved} onClick={copyDraft}>Copy approved draft</button>
              {draft.profileUrl && <a className={actionStyle} href={draft.profileUrl} target="_blank" rel="noreferrer">Open LinkedIn profile</a>}
              <button type="button" className={actionStyle} disabled={disabled || !approved || draft.sent}
                onClick={() => { if (window.confirm("Record that you already sent this approved draft to the prospect on LinkedIn?")) void run("mark_sent"); }}>
                {draft.sent ? "Marked sent" : "Mark as sent"}
              </button>
            </>}
            {channel === "email" && <>
            <button type="button" className={actionStyle} disabled={disabled || !approved} onClick={() => run("sandbox")}>Validate in sandbox</button>
            <button type="button" className={actionStyle} disabled={disabled || !approved || draft.testAccepted || draft.testUnconfirmed}
              onClick={() => { if (window.confirm("Send this approved version to the configured test inbox?")) void run("test_send"); }}>{draft.testAccepted ? "Test email accepted" : active === "test_send" ? "Sending test email…" : "Send test email"}</button>
            </>}
          </div>
          {draft.testUnconfirmed && <p role="alert">Test acceptance is unconfirmed. Check the test inbox or SendGrid before sending again.</p>}
          {draft.busy && !active && <p role="status">An outreach operation is pending. Reload to check its status.</p>}
          {draft.events.length > 0 && (
            <details className="rounded-lg border border-[#e5eaf2] p-3">
              <summary className="cursor-pointer font-semibold">Outreach activity</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {draft.events.map((event) => <li key={event.id}>{eventLabels[event.kind]} · <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></li>)}
              </ul>
            </details>
          )}
        </>
      )}
      {active && <p role="status">Working…</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="text-red-800">{error}</p>}
    </section>
  );
}
