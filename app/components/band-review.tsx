"use client";

import { useId, useRef, useState } from "react";
import type { z } from "zod";
import { BandReviewPreview, BandReviewReceipt, bandReviewQuestions, type BandReviewSource } from "@/app/lib/band-review-schema";
import { controlClass, primaryClass } from "./workspace-styles";

async function reviewRequest<T>(
  body: { action: "preview"; source: BandReviewSource } | { action: "send"; confirmed: true; token: string },
  schema: z.ZodType<T>,
) {
  const response = await fetch("/api/band/review", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "The Band review request failed.");
  return schema.parse(data);
}

export function BandReview({ source }: { source: BandReviewSource }) {
  const headingId = useId();
  const [preview, setPreview] = useState<z.infer<typeof BandReviewPreview>>();
  const [busy, setBusy] = useState<"preview" | "send">();
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<z.infer<typeof BandReviewReceipt>>();
  const pending = useRef(false);

  async function openPreview() {
    if (pending.current || receipt) return;
    pending.current = true;
    setBusy("preview");
    setPreview(undefined);
    setError("");
    try {
      setPreview(await reviewRequest({ action: "preview", source }, BandReviewPreview));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open the Band review preview.");
    } finally {
      pending.current = false;
      setBusy(undefined);
    }
  }

  async function postReview() {
    if (pending.current || receipt || !preview?.token) return;
    pending.current = true;
    setBusy("send");
    setError("");
    try {
      setReceipt(await reviewRequest({ action: "send", confirmed: true, token: preview.token }, BandReviewReceipt));
      setPreview(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not confirm whether the review posted.");
    } finally {
      pending.current = false;
      setBusy(undefined);
    }
  }

  return <div className="min-w-0 space-y-2 border-t border-[#e5eaf2] pt-3">
    {!preview && !receipt && <button type="button" className={controlClass} disabled={Boolean(busy)} onClick={openPreview}>
      {busy === "preview" ? "Loading Band preview…" : "Send to Band for review"}
    </button>}
    {receipt && <p role="status" className="font-semibold text-[#378564]">Posted to Band for review.</p>}
    {preview && <section aria-labelledby={headingId} className="min-w-0 space-y-4 rounded-lg border border-[#dce4f4] bg-[#f8faff] p-3 text-sm sm:p-4">
      <h4 id={headingId} className="font-bold">Band review preview</h4>
      <dl className="space-y-3 [overflow-wrap:anywhere]">
        <div><dt className="font-semibold">Destination room</dt><dd>{preview.roomTitle ?? preview.roomId ?? "Not configured"}
          {preview.roomTitle && preview.roomId && <span className="text-[#66748b]"> · {preview.roomId}</span>}</dd></div>
        <div><dt className="font-semibold">Reviewer</dt><dd>{preview.reviewerHandle ? `@${preview.reviewerHandle}` : "Not configured"}</dd></div>
        <div><dt className="font-semibold">Original source URL</dt><dd><a className="text-[#31569e] underline" href={preview.evidence.url}
          target="_blank" rel="noreferrer">{preview.evidence.url}</a></dd></div>
        <div><dt className="font-semibold">Exact excerpt</dt><dd><blockquote className="whitespace-pre-wrap border-l-2 border-[#dce4f4] pl-3">{preview.evidence.excerpt}</blockquote></dd></div>
        <div><dt className="font-semibold">Sourced observation</dt><dd>{preview.evidence.observation}</dd></div>
        <div><dt className="font-semibold">Atlas fit inference · hypothesis</dt><dd>{preview.evidence.inference}</dd></div>
      </dl>
      <div>
        <h5 className="font-semibold">Verdicts requested in Band</h5>
        <ol className="list-decimal pl-5">{bandReviewQuestions(preview.evidence.company).map((question) => <li key={question}>{question}</li>)}</ol>
      </div>
      {preview.setupMessage && <p role="status" className="text-[#66748b]">{preview.setupMessage}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {preview.token && <button type="button" className={primaryClass} onClick={postReview} disabled={Boolean(busy)}>
          {busy === "send" ? "Posting to Band…" : "Confirm and post to Band"}
        </button>}
        <button type="button" className={controlClass} disabled={Boolean(busy)} onClick={() => {
          setPreview(undefined);
          setError("");
        }}>Cancel</button>
      </div>
    </section>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </div>;
}
