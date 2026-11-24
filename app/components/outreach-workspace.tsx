"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { GraphResponse } from "@/app/lib/graph-schema";
import { OutreachContact, OutreachOverview, OutreachHistoryItem, OutreachResponse } from "@/app/lib/outreach-schema";
import { AccountOutreach, ContactEnrichment, eventLabels, postOutreach, type Channel } from "./account-outreach";

import { LinkedInProspects } from "./linkedin-prospects";
import { SourceEvidence } from "./source-evidence";
import { DemoPageHeader, demoPageClass } from "./demo-page";
import { controlClass, primaryClass, sectionClass } from "./workspace-styles";

type Match = z.infer<typeof GraphResponse>["matches"][number];
type Overview = z.infer<typeof OutreachOverview>;
export type HistoryItem = z.infer<typeof OutreachHistoryItem>;

export async function readWorkspace<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal) {
  const response = await fetch(path, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "The workspace could not complete the request.");
  return schema.parse(payload);
}

export function OutreachTimeline({ events }: { events: HistoryItem[] }) {
  if (!events.length) return <p className="text-sm text-[#66748b]">No outreach activity yet.</p>;
  return <ul className="divide-y divide-[#e5eaf2]">
    {events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
      <div><strong>{eventLabels[event.kind]}</strong>{event.demo && <span className="ml-2 rounded bg-[#edf2ff] px-2 py-1 text-xs text-[#31569e]">Demo activity</span>}
        <p>{event.recipient} · {event.company} · {event.channel === "email" ? "Email" : "LinkedIn"}</p></div>
      <time dateTime={event.at} className="text-[#66748b]">{new Date(event.at).toLocaleString()}</time>
    </li>)}
  </ul>;
}

export function OutreachWorkspace({ productId, initialMatch, onIntake, onDiscovery }: { productId: string; initialMatch: string; onIntake: () => void; onDiscovery: () => void }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [selected, setSelected] = useState(initialMatch);
  const [tab, setTab] = useState<"outreach" | "past">("outreach");
  const [channel, setChannel] = useState<Channel>("email");
  const [buyerId, setBuyerId] = useState("");
  const [overview, setOverview] = useState<Overview>({ events: [], contacts: [], targetRoles: [] });
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [draftRevision, setDraftRevision] = useState(0);
  const [error, setError] = useState("");
  const [contactPending, setContactPending] = useState(false);
  const [contactError, setContactError] = useState("");
  const activeScope = useRef({ matchId: selected, channel });
  useEffect(() => { activeScope.current = { matchId: selected, channel }; }, [selected, channel]);
  const account = matches.find(({ id }) => id === selected);

  useEffect(() => {
    const controller = new AbortController();
    readWorkspace(`/api/graph?${new URLSearchParams({ productId })}`, GraphResponse, controller.signal)
      .then(({ matches }) => {
        setMatches(matches);
        setSelected((prior) => matches.some(({ id }) => id === prior) ? prior : matches[0]?.id ?? "");
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ productId, matchId: selected, overview: "1" });
    readWorkspace(`/api/outreach?${query}`, OutreachOverview, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setOverview(data); })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [productId, selected, revision]);

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const { name, role, url, profileUrl } = Object.fromEntries(new FormData(form));
    setContactPending(true);
    setContactError("");
    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, matchId: selected, action: "add_contact", name, role, url, ...(profileUrl ? { profileUrl } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      form.reset();
      setRevision((value) => value + 1);
    } catch (error) {
      setContactError(error instanceof Error ? error.message : "Could not save the contact.");
    } finally {
      setContactPending(false);
    }
  }

  async function draftProspect(contact: z.infer<typeof OutreachContact>) {
    const matchId = selected;
    try {
      await postOutreach({ productId, matchId }, { action: "draft", channel: "linkedin", buyerId: contact.id }, OutreachResponse);
    } finally {
      setRevision((value) => value + 1);
    }
    if (activeScope.current.matchId !== matchId || activeScope.current.channel !== "linkedin") return;
    setDraftRevision((value) => value + 1);
    setBuyerId(contact.id);
    document.getElementById("outreach-draft")?.scrollIntoView({ block: "start" });
  }

  return <section className={demoPageClass}>
    <DemoPageHeader title="Outreach" description="Use saved accounts and public evidence to prepare and approve drafts."
      action={tab === "outreach" && !loading && (account
        ? <a href="#outreach-draft" className={primaryClass}>Go to draft</a>
        : <button type="button" className={primaryClass} onClick={onDiscovery}>Open Account discovery</button>)} />
    <div className="flex flex-wrap gap-2" role="group" aria-label="Outreach views">
      <button type="button" className={`${controlClass} aria-pressed:bg-[#edf2ff]`} aria-pressed={tab === "outreach"} onClick={() => setTab("outreach")}>Outreach</button>
      <button type="button" className={`${controlClass} aria-pressed:bg-[#edf2ff]`} aria-pressed={tab === "past"} onClick={() => setTab("past")}>Past outreach</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {tab === "past" ? <section className={sectionClass}><h2 className="font-semibold">Past outreach</h2><OutreachTimeline events={overview.events} /></section> :
      loading ? <p role="status">Loading saved accounts…</p> : !account ? <p>No saved accounts for this product. <button type="button" className="underline" onClick={onIntake}>Open Product intake</button></p> :
      <>
        <section className={`${sectionClass} flex flex-wrap items-end gap-3`} aria-label="Account and channel">
          <label className="grid min-w-0 max-w-full gap-1 text-sm font-semibold">Saved account <select className={`${controlClass} w-full min-w-0 text-ellipsis`} value={selected} disabled={contactPending}
            onChange={(event) => { setSelected(event.target.value); setBuyerId("");
              setOverview((current) => ({ ...current, contacts: [], targetRoles: [] })); setContactError(""); }}>
            {matches.map((match) => <option key={match.id} value={match.id}>{match.company} · ICP {new Date(match.approvedAt).toLocaleDateString()}</option>)}
          </select></label>
          <label className="grid gap-1 text-sm font-semibold">Channel <select className={controlClass} value={channel} onChange={(event) => setChannel(event.target.value === "linkedin" ? "linkedin" : "email")}>
            <option value="email">Email</option><option value="linkedin">LinkedIn</option>
          </select></label>
        </section>
        <section className={`${sectionClass} min-w-0 space-y-4 [overflow-wrap:anywhere] sm:p-6`} aria-labelledby="outreach-contacts-title">
          <header className="space-y-1 border-b border-[#e5eaf2] pb-4">
            <h2 id="outreach-contacts-title" className="text-lg font-bold text-[#243148]">Contacts</h2>
            <p className="text-sm text-[#66748b]">{account.company} · {account.domain}</p>
          </header>
          {channel === "linkedin" && <>
            <p className="text-sm font-medium text-[#536780]">Public-source contact discovery and LinkedIn draft-and-copy</p>
            <LinkedInProspects key={selected} productId={productId} matchId={selected} company={account.company}
              targetRoles={overview.targetRoles} onDraft={draftProspect} />
          </>}
          {overview.contacts.length ? <ul className="divide-y divide-[#e5eaf2]">
            {overview.contacts.map((buyer) => <li key={buyer.id} className="space-y-2 py-3 text-sm">
              <label className="flex flex-wrap items-baseline gap-2">
                <input type="radio" name="outreach-contact" checked={buyerId === buyer.id} onChange={() => setBuyerId(buyer.id)} />
                <strong>{buyer.name}</strong> <span>{buyer.role} · {account.company}{buyer.manual ? " · Founder-supplied" : ""}</span>
              </label>
              {buyer.excerpt && buyer.retrievedAt ? <SourceEvidence excerpt={buyer.excerpt} url={buyer.url} retrievedAt={buyer.retrievedAt} /> :
                <a className="text-sm text-[#31569e] underline" href={buyer.url} target="_blank" rel="noreferrer">Public role source</a>}
              {buyer.profileUrl && <a className="block text-[#31569e] underline" href={buyer.profileUrl} target="_blank" rel="noreferrer">Open sourced LinkedIn profile</a>}
              {account.domain && <ContactEnrichment scope={{ productId, matchId: selected }} buyer={buyer} />}
            </li>)}
          </ul> : <p className="rounded-lg border border-dashed border-[#dce4f4] p-4 text-sm text-[#52627d]">Add a named contact to look up their work email.</p>}
          {channel === "email" && buyerId && <button type="button" className={controlClass} onClick={() => setBuyerId("")}>Use company team for email draft</button>}
          <details open={overview.contacts.length === 0} className="rounded-lg border border-[#dbe5f1] bg-[#f5f9fe] p-3 text-sm sm:p-4">
            <summary className="cursor-pointer rounded font-semibold text-[#31569e] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#31569e]">Add a contact with a public role source</summary>
            <form onSubmit={addContact} className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1">Name <input className={`${controlClass} w-full min-w-0 font-normal text-[#243148] focus-visible:outline-2 focus-visible:outline-[#31569e]`} name="name" required maxLength={160} /></label>
              <label className="grid min-w-0 gap-1">Current role <input className={`${controlClass} w-full min-w-0 font-normal text-[#243148] focus-visible:outline-2 focus-visible:outline-[#31569e]`} name="role" required maxLength={160} /></label>
              <label className="grid min-w-0 gap-1">Public role source <input className={`${controlClass} w-full min-w-0 font-normal text-[#243148] focus-visible:outline-2 focus-visible:outline-[#31569e]`} name="url" required type="url" /></label>
              <label className="grid min-w-0 gap-1">Public LinkedIn profile (optional) <input className={`${controlClass} w-full min-w-0 font-normal text-[#243148] focus-visible:outline-2 focus-visible:outline-[#31569e]`} name="profileUrl" type="url" /></label>
              <button type="submit" className={`${controlClass} justify-self-start`} disabled={contactPending}>{contactPending ? "Saving contact…" : "Save contact"}</button>
            </form>
            {contactError && <p role="alert">{contactError}</p>}
          </details>
        </section>
        <section id="outreach-draft" aria-labelledby="outreach-draft-title" className={`${sectionClass} min-w-0 scroll-mt-4 space-y-4 sm:p-6`}>
          <h2 id="outreach-draft-title" className="border-b border-[#e5eaf2] pb-4 text-lg font-bold text-[#243148]">Draft</h2>
          {channel === "linkedin" && !buyerId && <p className="text-sm">Select a named contact to start a LinkedIn draft.</p>}
          <AccountOutreach key={`${selected}:${channel}:${buyerId}:${draftRevision}`} productId={productId} matchId={selected} channel={channel} buyerId={buyerId || undefined}
            onActivity={() => setRevision((value) => value + 1)} />
        </section>
      </>}
  </section>;
}
